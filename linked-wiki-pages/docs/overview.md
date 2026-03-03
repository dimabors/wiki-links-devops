# Link Work Items to Wiki Pages

This extension will add a custom UI control for all Work Item forms. With this UI control you will be able to see all the Wiki Pages that were attached to current Work Item.

### How to install

After you install this extension from Marketplace it will automatically add custom UI control to all Work Item forms, no further configuration required. 

### How to use

#### 1
![01](screenshots/01.png)

**1.1.** When you open some Work Item from backlog you will see that there are, probably, no linked Wiki pages yet.  
**1.2.** To link some Wiki pages navigate to `Links` tab of Work Item.  

#### 2
![02](screenshots/02.png)

**2.1.** Click on `Add link` to add a new link for current Work Item.  
**2.2.** Choose `Existing Item` to add a link for already existing Wiki page.  

#### 3
![03](screenshots/03.png)

**3.1.** Choose `Wiki page` for link type.  
**3.2.** Click on `...` to select Wiki page from tree view.  

#### 4
![04](screenshots/04.png)

**4.1.** Choose which Wiki page will be linked to current Work Item. Click `OK`.  

#### 5
![05](screenshots/05.png)

**5.1.** Now you can get back to `Details` tab and see that linked Wiki page is displayed inside the `Linked wiki pages` section. You can now save and close your Work Item. When you will open it next time, all linked Wiki pages will be in place.  

---

## Auto-Link Scanner

Instead of manually linking wiki pages to work items, you can use the **Wiki Auto-Link Scanner** to do it automatically. The scanner reads through all wiki pages in your project and finds work-item references written as `#123`. For every reference it finds, it creates an artifact link from the work item back to the wiki page.

### How to use the scanner

#### 1 – Open the scanner hub
Navigate to **Boards** (Work hub group) and select **Wiki Auto-Link Scanner** from the navigation.

#### 2 – Choose scan mode
- **Dry run** (checked by default) – previews which links *would* be created, without modifying anything.
- Uncheck **Dry run** to create the links for real.

#### 3 – Run the scanner
Click **Scan Wiki Pages**. The log area shows real-time progress: which pages are scanned, which work items are referenced, and whether links are created, skipped (already exist), or encounter errors.

#### 4 – Review results
After the scan completes you will see a summary with:
- Pages scanned  
- Links created (or "would create" in dry-run mode)  
- Links skipped (already existed)  
- Errors  
