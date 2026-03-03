/**
 * Wiki Scanner - Scans wiki pages for work item references (#NNN) and
 * automatically creates artifact links from work items back to the wiki pages.
 *
 * Uses the VSS SDK REST clients so requests work inside the extension iframe.
 *
 * @param {object}   options
 * @param {object}   options.context    - VSS web context
 * @param {object}   options.gitClient  - GitHttpClient from TFS/VersionControl/GitRestClient
 * @param {object}   options.witClient  - WorkItemTrackingHttpClient from TFS/WorkItemTracking/RestClient
 * @param {function} options.getAuthHeader - Returns a promise for Authorization header (for Wiki API)
 * @param {function} options.onProgress - Progress callback
 */
function createWikiScanner(options) {
    var context    = options.context;
    var gitClient  = options.gitClient;
    var witClient  = options.witClient;
    var onProgress = options.onProgress || function () {};
    var getAuthHeader = options.getAuthHeader;

    var projectName   = context.project.name;
    var projectId     = context.project.id;
    var collectionUri = context.collection.uri;

    var REQUEST_TIMEOUT_MS = 15000;

    // ── Fallback XHR (only for Wiki list/tree APIs with no SDK client) ──

    var _authHeaderPromise = null;
    function getCachedAuthHeader() {
        if (!_authHeaderPromise) {
            _authHeaderPromise = getAuthHeader();
        }
        return _authHeaderPromise;
    }

    function apiGet(url) {
        return getCachedAuthHeader().then(function (authHeader) {
            return new Promise(function (resolve, reject) {
                var xhr = new XMLHttpRequest();
                var timedOut = false;
                var timer = setTimeout(function () {
                    timedOut = true; xhr.abort();
                    reject(new Error("Timed out: " + url));
                }, REQUEST_TIMEOUT_MS);

                xhr.open("GET", url, true);
                xhr.setRequestHeader("Authorization", authHeader);
                xhr.setRequestHeader("Accept", "application/json");
                xhr.onload = function () {
                    clearTimeout(timer);
                    if (timedOut) return;
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try { resolve(JSON.parse(xhr.responseText)); }
                        catch (e) { resolve(xhr.responseText); }
                    } else { reject(new Error("HTTP " + xhr.status + " – " + url)); }
                };
                xhr.onerror = function () { clearTimeout(timer); reject(new Error("Network error: " + url)); };
                xhr.onabort = function () { clearTimeout(timer); if (!timedOut) reject(new Error("Aborted")); };
                xhr.send();
            });
        });
    }

    // ── Wiki API (XHR – only list & tree, which are lightweight) ────────

    function getWikis() {
        return apiGet(collectionUri + encodeURIComponent(projectName) + "/_apis/wiki/wikis?api-version=6.0");
    }

    function getPageTree(wikiId) {
        return apiGet(
            collectionUri + encodeURIComponent(projectName) +
            "/_apis/wiki/wikis/" + encodeURIComponent(wikiId) +
            "/pages?path=%2F&recursionLevel=full&api-version=6.0"
        );
    }

    function flattenPages(page) {
        var pages = [];
        if (page && page.path) {
            pages.push({ path: page.path, gitItemPath: page.gitItemPath || page.path });
        }
        if (page && page.subPages) {
            page.subPages.forEach(function (sub) {
                pages = pages.concat(flattenPages(sub));
            });
        }
        return pages;
    }

    // ── Git content fetch via SDK ───────────────────────────────────────

    function getPageMarkdown(repoId, gitItemPath) {
        var mdPath = gitItemPath;
        if (mdPath && !mdPath.endsWith(".md")) {
            mdPath = mdPath + ".md";
        }
        onProgress("    Git fetch: repo=" + repoId + "  path=" + mdPath);

        // gitClient.getItemContent returns an ArrayBuffer
        return gitClient.getItemContent(repoId, mdPath, projectName)
            .then(function (buf) {
                if (typeof buf === "string") return buf;
                if (buf instanceof ArrayBuffer || (buf && buf.byteLength !== undefined)) {
                    return new TextDecoder("utf-8").decode(new Uint8Array(buf));
                }
                return String(buf || "");
            });
    }

    // ── Parsing ─────────────────────────────────────────────────────────

    function parseWorkItemReferences(content) {
        if (!content) return [];
        var cleaned = content.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");

        var ids = {}, match, id;

        var urlRe = /\/_workitems\/edit\/(\d+)/g;
        while ((match = urlRe.exec(cleaned)) !== null) {
            id = parseInt(match[1], 10);
            if (id > 0 && id < 10000000) ids[id] = true;
        }

        var hashRe = /#(\d+)\b/g;
        while ((match = hashRe.exec(cleaned)) !== null) {
            id = parseInt(match[1], 10);
            if (id > 0 && id < 10000000) ids[id] = true;
        }

        return Object.keys(ids).map(function (k) { return parseInt(k, 10); });
    }

    // ── Work-item linking (via SDK) ─────────────────────────────────────

    function buildArtifactUri(wikiName, pagePath) {
        return "vstfs:///Wiki/WikiPage/" + projectId + "/" + wikiName + pagePath;
    }

    // ── Orchestration ───────────────────────────────────────────────────

    function processPage(wiki, pageObj, results, discoveredLinks) {
        var pagePath    = pageObj.path;
        var gitItemPath = pageObj.gitItemPath;

        // Skip root page — no .md file
        if (pagePath === "/") {
            results.pagesScanned++;
            onProgress("  Skipping root '/'.");
            return Promise.resolve();
        }

        onProgress("  Processing: " + pagePath);

        return getPageMarkdown(wiki.repositoryId, gitItemPath)
            .then(function (md) {
                results.pagesScanned++;
                onProgress("  '" + pagePath + "' (" + (md || "").length + " chars).");

                var wiIds = parseWorkItemReferences(md);
                if (wiIds.length === 0) {
                    onProgress("  No work-item refs in '" + pagePath + "'.");
                    return;
                }
                results.referencesFound += wiIds.length;
                onProgress("  Refs: #" + wiIds.join(", #"));

                // Check each reference and collect into discoveredLinks
                var chain = Promise.resolve();
                wiIds.forEach(function (wiId) {
                    chain = chain.then(function () {
                        var artifactUri = buildArtifactUri(wiki.name, pagePath);
                        return witClient.getWorkItem(wiId, null, null, 4)
                            .then(function (workItem) {
                                var already = (workItem.relations || []).some(function (r) {
                                    return r.url === artifactUri;
                                });
                                if (already) {
                                    results.linksSkipped++;
                                    onProgress("  - #" + wiId + " already linked");
                                } else {
                                    var title = (workItem.fields && workItem.fields["System.Title"]) || "";
                                    discoveredLinks.push({
                                        workItemId: wiId,
                                        workItemTitle: title,
                                        wikiName: wiki.name,
                                        pagePath: pagePath,
                                        artifactUri: artifactUri
                                    });
                                    onProgress("  + #" + wiId + " (" + title + ") → new link");
                                }
                            })
                            .catch(function (err) {
                                results.errors.push({ workItemId: wiId, reason: err.message || String(err) });
                                onProgress("  ! #" + wiId + ": " + (err.message || String(err)));
                            });
                    });
                });
                return chain;
            })
            .catch(function (err) {
                var msg = err.message || String(err);
                if (msg.indexOf("404") !== -1) {
                    onProgress("  Skipping '" + pagePath + "' (no .md file).");
                    results.pagesScanned++;
                    return;
                }
                results.errors.push({ pagePath: pagePath, reason: msg });
                onProgress("  ! Error: " + msg);
            });
    }

    function processWiki(wiki, results, discoveredLinks) {
        onProgress("Scanning wiki: " + wiki.name + " (repo: " + wiki.repositoryId + ")");
        return getPageTree(wiki.id).then(function (root) {
            var pages = flattenPages(root);
            onProgress("Found " + pages.length + " page(s).");
            var chain = Promise.resolve();
            pages.forEach(function (p) {
                chain = chain.then(function () { return processPage(wiki, p, results, discoveredLinks); });
            });
            return chain;
        });
    }

    /**
     * Phase 1: Scan all wikis and discover links that need to be created.
     * Returns { results, discoveredLinks[] }.
     */
    function scan() {
        var results = {
            pagesScanned: 0, referencesFound: 0,
            linksCreated: 0, linksSkipped: 0, linksWouldCreate: 0,
            errors: []
        };
        var discoveredLinks = [];

        onProgress("Starting wiki scan...");

        return getWikis().then(function (resp) {
            var wikis = resp.value || [];
            if (!wikis.length) { onProgress("No wikis found."); return { results: results, discoveredLinks: discoveredLinks }; }
            onProgress("Found " + wikis.length + " wiki(s).");

            var chain = Promise.resolve();
            wikis.forEach(function (w) {
                chain = chain.then(function () { return processWiki(w, results, discoveredLinks); });
            });
            return chain.then(function () {
                onProgress("─── Scan Complete ───");
                onProgress("Pages scanned: " + results.pagesScanned);
                onProgress("References found: " + results.referencesFound);
                onProgress("New links to create: " + discoveredLinks.length);
                onProgress("Already linked: " + results.linksSkipped);
                if (results.errors.length) onProgress("Errors: " + results.errors.length);
                return { results: results, discoveredLinks: discoveredLinks };
            });
        });
    }

    /**
     * Phase 2: Create links for the selected items.
     * @param {Array} items - array of { workItemId, wikiName, pagePath, artifactUri }
     */
    function applyLinks(items) {
        var created = 0, errors = [];
        onProgress("Creating " + items.length + " link(s)...");

        var chain = Promise.resolve();
        items.forEach(function (item) {
            chain = chain.then(function () {
                onProgress("  Linking #" + item.workItemId + " → " + item.pagePath + " ...");
                var patch = [{
                    op: "add", path: "/relations/-",
                    value: { rel: "ArtifactLink", url: item.artifactUri, attributes: { name: "Wiki Page" } }
                }];
                return witClient.updateWorkItem(patch, item.workItemId)
                    .then(function () {
                        created++;
                        onProgress("  + Linked #" + item.workItemId);
                    })
                    .catch(function (err) {
                        errors.push({ workItemId: item.workItemId, reason: err.message || String(err) });
                        onProgress("  ! #" + item.workItemId + ": " + (err.message || String(err)));
                    });
            });
        });

        return chain.then(function () {
            onProgress("─── Done: " + created + " created, " + errors.length + " errors ───");
            return { created: created, errors: errors };
        });
    }

    /**
     * Scan all wikis for references to a specific work item and create links.
     * @param {number} workItemId - The work item ID to scan for
     * @returns Promise<{ linksCreated, linksSkipped, errors[] }>
     */
    function scanForWorkItem(workItemId) {
        var created = 0, skipped = 0, errors = [];
        onProgress("Scanning wikis for references to #" + workItemId + "...");

        return getWikis().then(function (resp) {
            var wikis = resp.value || [];
            if (!wikis.length) { onProgress("No wikis found."); return { linksCreated: 0, linksSkipped: 0, errors: [] }; }

            var chain = Promise.resolve();
            wikis.forEach(function (wiki) {
                chain = chain.then(function () {
                    return getPageTree(wiki.id).then(function (root) {
                        var pages = flattenPages(root);
                        var inner = Promise.resolve();
                        pages.forEach(function (pageObj) {
                            inner = inner.then(function () {
                                if (pageObj.path === "/") return;
                                return getPageMarkdown(wiki.repositoryId, pageObj.gitItemPath)
                                    .then(function (md) {
                                        var refs = parseWorkItemReferences(md);
                                        if (refs.indexOf(workItemId) === -1) return;

                                        var artifactUri = buildArtifactUri(wiki.name, pageObj.path);
                                        return witClient.getWorkItem(workItemId, null, null, 4)
                                            .then(function (wi) {
                                                var already = (wi.relations || []).some(function (r) { return r.url === artifactUri; });
                                                if (already) {
                                                    skipped++;
                                                    onProgress("  - " + pageObj.path + " already linked");
                                                    return;
                                                }
                                                var patch = [{ op: "add", path: "/relations/-",
                                                    value: { rel: "ArtifactLink", url: artifactUri, attributes: { name: "Wiki Page" } } }];
                                                return witClient.updateWorkItem(patch, workItemId).then(function () {
                                                    created++;
                                                    onProgress("  + Linked " + pageObj.path);
                                                });
                                            });
                                    })
                                    .catch(function (err) {
                                        var msg = err.message || String(err);
                                        if (msg.indexOf("404") === -1) {
                                            errors.push({ pagePath: pageObj.path, reason: msg });
                                            onProgress("  ! " + pageObj.path + ": " + msg);
                                        }
                                    });
                            });
                        });
                        return inner;
                    });
                });
            });
            return chain.then(function () {
                onProgress("Done: " + created + " created, " + skipped + " already linked.");
                return { linksCreated: created, linksSkipped: skipped, errors: errors };
            });
        });
    }

    return { scan: scan, applyLinks: applyLinks, scanForWorkItem: scanForWorkItem };
}
