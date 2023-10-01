/*
    Written by Shan Eapen Koshy
    Date: 14 March 2020
*/
const FROM_CONTENT_SCRIPT = "FROM_CONTENT_SCRIPT";

// chrome.runtime.onMessage.addListener(
//     function (request, sender, sendResponse) {

//         //get Current Group Name
//         try {
//             var groupName = document.querySelectorAll("#main > header > div:nth-child(2) span")[0].title;
//         } catch (error) {
//             var groupName = '';
//             // TODO: Log error to sentry with the license code
//         }

//         if (request.contentScriptQuery == 'currentGroup') {
//             sendResponse(groupName)
//         } else if (request.contentScriptQuery == 'stopAutoScroll') {
//             WAXP.stop();

//             setTimeout(() => {
//                 chrome.tabs.sendMessage(tabs[0].id, {
//                     contentScriptQuery: 'instant-export-chatlist-all'
//                 }, function (response) {
//                     //nothing for now..just send message
//                 });

//             }, 2000);
//         } else {

//             var config = JSON.parse(request.contentScriptQuery);
//             WAXP.options.SCROLL_INCREMENT = config.SCROLL_INCREMENT ? config.SCROLL_INCREMENT * 1 : WAXP.options.SCROLL_INCREMENT;
//             WAXP.options.SCROLL_INTERVAL = config.SCROLL_INTERVAL ? config.SCROLL_INTERVAL * 1 : WAXP.options.SCROLL_INTERVAL;
//             WAXP.options.NAME_PREFIX = config.NAME_PREFIX;
//             var data = {
//                 isUsingTrial: true,
//                 TRIAL_USAGE_COUNT: 0,
//                 type: FROM_CONTENT_SCRIPT,
//                 text: config.EXPORT_TYPE,
//                 groupName: groupName,
//                 namePrefix: config.NAME_PREFIX
//             };
//             window.postMessage(data, "*");

//         }
//     }
// );


window.addEventListener("message", function (event) {
    // We only accept messages from ourselves
    if (event.source != window)
        return;

    if (event.data.message == "download") {
        console.log("WAXP:content_script: Starting excel export.")
        downloadAsCSV(event.data.data);
    }
});

function injectJS(url) {
    let s = document.createElement("script");
    s.type = "text/javascript";
    s.src = url;
    (document.head || document.body || document.documentElement).appendChild(s);
}

/**
 * Loads the store.js script to the DOM after WA Web has completely loaded.
 */
function addStore() {
    var timer = setInterval(function () {
        if (Boolean(document.getElementById('pane-side'))) {
            // if chatlist has loaded
            injectJS(chrome.runtime.getURL("/js/client.js"));
            injectJS(chrome.runtime.getURL("/js/libphonenumber-max.js"));
            clearInterval(timer);
        }
    }, 1000);
}

WAXP = (function () {

    addStore();

    MutationObserver = window.MutationObserver || window.WebKitMutationObserver;

    var SCROLL_INTERVAL = 600,
        SCROLL_INCREMENT = 450,
        AUTO_SCROLL = true,
        NAME_PREFIX = '',
        UNKNOWN_CONTACTS_ONLY = false,
        MEMBERS_QUEUE = {},
        TOTAL_MEMBERS;

    var CONTACTS_WITHOUT_PHONE_NUMBER;

    var scrollInterval, observer, membersList, header;

    console.log("%c Developed by hmime.com", "font-size:24px;font-weight:bold;color:white;background:green;");
    
    let interval = setInterval(() => {
        if (document.querySelector('[data-icon="menu"]')) {
          clearInterval(interval);
          let html = '<button onclick="downloadContacts()" class="webtovo-contacts" style="padding:5px;background:#fff;border-radius:5px"><img class="webtovo-contacts" src="chrome-extension://' + chrome.runtime.id + '/image/icon.png" width="20px" /></button>';
          document.querySelector('[data-icon="menu"]').parentElement.parentElement.parentElement.insertAdjacentHTML('afterend', html);
        }
      }, 5000);
    
    var getMembersListCard = function () {
        // Returns the container card holding the group members list
        return document.querySelectorAll('span[title=You]')[0]
            ?.parentNode
            ?.parentNode
            ?.parentNode
            ?.parentNode
            ?.parentNode
            ?.parentNode
            ?.parentNode
            ?.parentNode;
    }

    var start = function () {

        CONTACTS_WITHOUT_PHONE_NUMBER = new Set();
        membersList = getMembersListCard();
        header = document.getElementsByTagName('header')[0];

        if (!membersList) {
            document.querySelector("#main > header").firstChild.click();
            membersList = getMembersListCard();
            header = document.getElementsByTagName('header')[0];
        }

        observer = new MutationObserver(function (mutations, observer) {
            scrapeData(); // fired when a mutation occurs
        });

        // the div to watch for mutations
        observer.observe(membersList, {
            childList: true,
            subtree: true
        });

        TOTAL_MEMBERS = membersList.parentElement.parentElement.parentElement.querySelector('span').innerText.match(/\d+/)[0] * 1;

        // click the `n more` button to show all members
        document.querySelector("span[data-icon=down]")?.click()

        //scroll to top before beginning
        header.nextSibling.scrollTop = 100;
        scrapeData();

        if (AUTO_SCROLL) scrollInterval = setInterval(autoScroll, SCROLL_INTERVAL);
    }


    /**
     *  Function to autoscroll the div
     */

    var autoScroll = function () {
        if (!utils.scrollEndReached(header.nextSibling))
            header.nextSibling.scrollTop += SCROLL_INCREMENT;
        else
            stop();
    };

    /**
     *  Stops the current scrape instance and prepares data for download
     */

    var stop = function () {

        window.clearInterval(scrollInterval);
        observer.disconnect();
        console.log(`%c Extracted [${utils.queueLength()} / ${TOTAL_MEMBERS}] Members. Starting Download..`, `font-size:13px;color:white;background:green;border-radius:10px;`)

        //Preparing data for download
        if (utils.queueLength() > 0) {

            var data = "Name, Phone, Status\n";

            for (key in MEMBERS_QUEUE) {
                // Wrapping each variable around double quotes to prevent commas in the string from adding new cols in CSV
                // replacing any double quotes within the text to single quotes
                data += `"${MEMBERS_QUEUE[key]['Name']}","${key}","${MEMBERS_QUEUE[key]['Status'].replace(/\"/g, "'")}"\n`;
            }

            // Saved contacts that doesn't have a profile picture will not contain their phone number details
            if (CONTACTS_WITHOUT_PHONE_NUMBER.size > 0) {
                data += `\n CONTACTS WITHOUT PHONE NUMBER`;
                CONTACTS_WITHOUT_PHONE_NUMBER.forEach(function (el) {
                    data += `\n"${el}"`;
                })
            }

            downloadAsCSV(data);

        } else {
            alert("Couldn't find any unsaved contacts in this group!");
        }


    }

    /**
     *  Function to scrape member data
     */
    var scrapeData = function () {
        var contact, status, name;
        var memberCard = membersList.querySelectorAll(':scope > div');

        for (let i = 0; i < memberCard.length; i++) {

            status = memberCard[i].querySelectorAll('span[title]')[1] ? memberCard[i].querySelectorAll('span[title]')[1].title : "";
            contact = scrapePhoneNum(memberCard[i]);
            name = scrapeName(memberCard[i]);

            if (contact.phone != 'NIL' && !MEMBERS_QUEUE[contact.phone]) {

                if (contact.isUnsaved) {
                    MEMBERS_QUEUE[contact.phone] = {
                        'Name': NAME_PREFIX + name,
                        'Status': status
                    };
                    continue;
                } else if (!UNKNOWN_CONTACTS_ONLY) {
                    MEMBERS_QUEUE[contact.phone] = {
                        'Name': name,
                        'Status': status
                    };
                }
                CONTACTS_WITHOUT_PHONE_NUMBER.delete(name);

            } else if (contact.phone == 'NIL' && !contact.isUnsaved) {
                CONTACTS_WITHOUT_PHONE_NUMBER.add(name);
            } else if (MEMBERS_QUEUE[contact.phone]) {
                MEMBERS_QUEUE[contact.phone].Status = status;
            }

            if (utils.queueLength() >= TOTAL_MEMBERS) {
                stop();
                break;
            }

            //console.log(`%c Extracted [${utils.queueLength()} / ${TOTAL_MEMBERS}] Members `,`font-size:13px;color:white;background:green;border-radius:10px;`)
        }
    }

    /**
     * Scrapes phone no from html node
     * @param {object} el - HTML node
     * @returns {string} - phone number without special chars
     */

    var scrapePhoneNum = function (el) {
        var phone, isUnsaved = false;
        if (el.querySelector('img') && el.querySelector('img').src.match(/u=[0-9]*/)) {
            phone = el.querySelector('img').src.match(/u=[0-9]*/)[0].substring(2).replace(/[+\s]/g, '');
        } else {
            var temp = el.querySelector('span[title]').getAttribute('title').match(/(.?)*[0-9]{3}$/);
            if (temp) {
                phone = temp[0].replace(/\D/g, '');
                isUnsaved = true;
            } else {
                phone = 'NIL';
            }
        }
        return {
            'phone': phone,
            'isUnsaved': isUnsaved
        };
    }

    /**
     *  Scrapes name from HTML node
     * @param {object} el - HTML node
     * @returns {string} - returns name..if no name is present phone number is returned
     */

    var scrapeName = function (el) {
        expectedName = el.firstChild.childNodes[0].childNodes[1].firstChild.querySelector('span').innerText
        if (expectedName == "") {
            return el.querySelector('span[title]').getAttribute('title'); //phone number
        }
        return expectedName;
    }


    /**
     * A utility function to download the result as CSV file
     * @References
     * [1] - https://stackoverflow.com/questions/4617935/is-there-a-way-to-include-commas-in-csv-columns-without-breaking-the-formatting
     * 
     */
    var downloadAsCSV = function (data) {

        var groupName = document.querySelectorAll("#main > header span")[1].title;
        var fileName = groupName.replace(/[^\d\w\s]/g, '') ? groupName.replace(/[^\d\w\s]/g, '') : 'WAXP-group-members';

        var a = document.createElement('a');
        a.style.display = "none";

        var url = window.URL.createObjectURL(new Blob([data], {
            type: "data:attachment/text"
        }));
        a.setAttribute("href", url);
        a.setAttribute("download", `${fileName}.csv`);
        document.body.append(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
    }

    /**
     *  Scrape contacts instantly from the group header.
     *  Saved Contacts cannot be exchanged for numbers with this method.
     */

    var quickExport = function () {

        var members = document.querySelectorAll("#main > header span")[2].title.replace(/ /g, '').split(',');
        var data = "Phone\n";

        members.pop(); //removing 'YOU' from array

        MEMBERS_QUEUE = {};

        if (members[members.length - 1].match(/^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/)) {
            //If the last member is a phone number, then we have something to export otherwise all members are already saved
            for (i = 0; i < members.length; ++i)
                if (members[i].match(/^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/))
                    data += `${members[i]}\n`;

            downloadAsCSV(data);
        } else {
            alert("No unknown phone numbers are present.");
        }
    }

    /**
     *  Helper functions
     *  @References [1] https://stackoverflow.com/questions/53158796/get-scroll-position-with-reactjs/53158893#53158893
     */

    var utils = (function () {

        return {
            scrollEndReached: function (el) {
                if ((el.scrollHeight - (el.clientHeight + el.scrollTop)) == 0)
                    return true;
                return false;
            },
            queueLength: function () {
                var size = 0,
                    key;
                for (key in MEMBERS_QUEUE) {
                    if (MEMBERS_QUEUE.hasOwnProperty(key)) size++;
                }
                return size;
            }
        }
    })();


    // Defines the WAXP interface following module pattern
    return {
        start: function () {
            MEMBERS_QUEUE = {}; //reset
            try {
                start();
            } catch (error) {
                //TO overcome below error..but not sure of any sideeffects
                //TypeError: Failed to execute 'observe' on 'MutationObserver': parameter 1 is not of type 'Node'.
                console.log(error, '\nRETRYING in 1 second')
                setTimeout(start, 1000);
            }
        },
        stop: function () {
            stop()
        },
        options: {
            // works for now...but consider refactoring it provided better approach exist
            set NAME_PREFIX(val) {
                NAME_PREFIX = val
            },
            set SCROLL_INTERVAL(val) {
                SCROLL_INTERVAL = val
            },
            set SCROLL_INCREMENT(val) {
                SCROLL_INCREMENT = val
            },
            set AUTO_SCROLL(val) {
                AUTO_SCROLL = val
            },
            set UNKNOWN_CONTACTS_ONLY(val) {
                UNKNOWN_CONTACTS_ONLY = val
            },
            // getter
            get NAME_PREFIX() {
                return NAME_PREFIX
            },
            get SCROLL_INTERVAL() {
                return SCROLL_INTERVAL
            },
            get SCROLL_INCREMENT() {
                return SCROLL_INCREMENT
            },
            get AUTO_SCROLL() {
                return AUTO_SCROLL
            },
            get UNKNOWN_CONTACTS_ONLY() {
                return UNKNOWN_CONTACTS_ONLY
            },
        },
        quickExport: function () {
            quickExport();
        },
        debug: function () {
            return {
                size: utils.queueLength(),
                q: MEMBERS_QUEUE
            }
        }
    }
})();

/**
 * Function to export to Excel format
 * @param {String} fileName 
 * @param {Object} data  
 * 
 * Example Data format:
 *   payload = {
        headers: ["Name", "Phone", "Country"],
        type: "groups", // or "chatlist", "labels"
        filter: "unsaved", // or "all"
        groups: {
            groupName1: [
                ["Shan", "9656382333", "India"],
                ["Saira", "9656382333", "India"]
            ],
            groupName2: [
                ["Shan", "9656382333", "India"],
            ]
        }
    }
 */
function RunExcelJSExport(data) {
    console.log(data)

    let fileName = data.fileName;
    if (!fileName) fileName = "WAXP Export.xlsx";
    if (!fileName.endsWith(".xlsx")) fileName += ".xlsx";

    let wb = new ExcelJS.Workbook();

    const COL_WIDTHS = {
        name: 20,
        phone: 20,
        'last contacted': 25,
        country: 20,
    }

    for (const [key, contacts] of Object.entries(data[data.type])) {
        let worksheetName = key;
        let ws = wb.addWorksheet(worksheetName,
            {
                properties: {
                    tabColor: { argb: 'FFFF0000' } // Create a random color
                },
            }
        );
        ws.headerFooter.firstHeader = "Page &P of &N";

        // Preparing the headers in the format that ExcelJS expects
        const headers = data.headers.map(header => {
            let colHeader = {
                key: getKey(header),
                header: header,
            }
            // Set the column's width if a width is specified in the mapping variable
            if (COL_WIDTHS[colHeader.key]) colHeader["width"] = COL_WIDTHS[colHeader.key];
            return colHeader;
        });

        // Adding the columns..A new copy of the object has to be supplied
        ws.columns = headers.slice();

        // Add contacts to sheet
        ws.addRows(contacts);

        // Bold the header
        ws.getRow(1).font = { bold: true };

        ws.views = [{ state: "frozen", ySplit: 1 }];

    }

    // Saving file
    wb.xlsx.writeBuffer()
        .then(function (buffer) {
            saveAs(
                new Blob([buffer], { type: "application/octet-stream" }),
                fileName
            );
            // Signal download complete
            window.postMessage({
                type: FROM_CONTENT_SCRIPT,
                text: "download-complete"
            }, "*");
        });
}

function getKey(name) {
    return name.toLowerCase();
}
