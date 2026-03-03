/**
 *
 * @param model
 * @param artifactsServices
 * @param artifactsConstants
 * @returns {{error: KnockoutObservable<any>, view: KnockoutObservable<any>, links: KnockoutObservableArray<any>}}
 */
function getViewModel(model, artifactsServices, artifactsConstants) {
    var con = {
        wait: "wait",
        links: "links",
        error: "error"
    };

    var viewModel = {
        error: ko.observable(""),
        view: ko.observable(""),

        links: ko.observableArray([])
    };

    viewModel.isWaitVisible = ko.pureComputed(function () {
        return viewModel.view() === con.wait;
    });
    viewModel.showWait = function () {
        viewModel.view(con.wait);
    };

    viewModel.isLinksVisible = ko.pureComputed(function () {
        return viewModel.view() === con.links;
    });
    viewModel.isEmptyVisible = ko.pureComputed(function () {
        return (viewModel.view() === con.links) && (viewModel.links().length === 0);
    });
    viewModel.showLinks = function () {
        viewModel.view(con.links);
    };

    viewModel.isErrorVisible = ko.pureComputed(function () {
        return viewModel.view() === con.error;
    });
    viewModel.showError = function () {
        viewModel.view(con.error);
    };

    viewModel.clear = function () {
        viewModel.showWait();
        viewModel.removeAll();
        viewModel.showLinks();
    };

    viewModel.reload = function () {
        viewModel.showWait();
        model.getCurrentWorkItemRelations()
            .then(function (links) {
                viewModel.links.removeAll();

                links
                    // filter for valid links only
                    .filter(function (link) {
                        return link.url.startsWith("vstfs:///");
                    })
                    // get link data
                    .map(function (link) {
                        return artifactsServices.LinkingUtilities.decodeUri(link.url);
                    })
                    // filter for wiki pages only
                    .filter(function(artifact) {
                        return artifact.type === artifactsConstants.ArtifactTypeNames.WikiPage;
                    })
                    // get UI link items
                    .map(function(artifact) {
                        var segments = artifact.id.split("/");
                        // segments[0] = projectId (GUID), segments[1] = wikiName, segments[2+] = page path
                        var wikiProjectId = segments[0];
                        var pageSegments = [];
                        for (var i = 2; i < segments.length; i++) {
                            pageSegments.push(segments[i]);
                        }

                        var url = [
                            model.context.account.uri,
                            encodeURIComponent(wikiProjectId),
                            "/_wiki/wikis/",
                            encodeURIComponent(segments[1]) + "?pagePath=" + encodeURIComponent(pageSegments.join("/"))
                        ].join("");

                        // Prevent javascript: or data: scheme injection
                        if (!/^https?:\/\//i.test(url)) {
                            url = "#";
                        }

                        return {
                            url: url,
                            text: pageSegments[pageSegments.length - 1]
                        };
                    })
                    // bind to UI
                    .forEach(function (linkItem) {
                        viewModel.links.push(linkItem);
                    });

                viewModel.showLinks();
            },
            function (error) {
                viewModel.error(error.message);
                viewModel.showError();
            });
    };

    return viewModel;
}