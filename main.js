// Copyright (c) 2020 Jacopo Donati
// 
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

"use strict";

process.binding('http_parser').HTTPParser = require('http-parser-js').HTTPParser;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const winston = require('winston')
const commander = require('commander');
const program = new commander.Command();
const fetch = require('node-fetch');
const fs = require('fs');
const pad = require('pad');
const del = require('del');

const logger = winston.createLogger({
    level: 'info',
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

main();

async function main() {
    logger.debug('EDRA-dl');

    logger.debug('Setting up di Program');

    program
        .version('1.3.0')
        .requiredOption('-i, --isbn [ISBN code]', 'ISBN code for the beook')
        .option('-I, --get-info', 'Downloads and prints book info')
        .option('-f, --full-speed', 'Don\'t wait between pages')
        .option('-t, --test', 'Download and compile the first four pages')
        .option('-d, --dry-run', 'Ain\'t download nothin\'')
        .option('-D, --download', 'Downloads without PDF output')
        .option('-r, --range <range>', 'Download selected range.  Range is formatted as "start-end" (e.g. 21-34).  "start-" and "-end" is also accepted.')
        .option('-p, --purge', 'Purge temporary files after download')
        .option('-c, --compile', 'Output a PDF from previously downloaded pages')
        .option('-s, --single', 'Output a PDF for each page')
        .option('-v, --verbose', 'Show debug');

    program.parse(process.argv);

    if ((program.dryRun && program.download) || (program.compile && program.download)) {
        logger.error('Options are incompatible, dummy.');
        process.exit(1);
    }

    let isbn = program.isbn;
    if (program.verbose) {
        logger.level = 'debug';
        console.log(program.opts());
    }

    logger.info(`Looking for ${isbn} info`);
    
    const tmpRootDir = './tmp/';
    if (!fs.existsSync(tmpRootDir)) {
        logger.debug(`Making ${tmpRootDir}`);
        fs.mkdirSync(tmpRootDir);
    }
    const tmpDir = tmpRootDir + isbn;
    if (!fs.existsSync(tmpDir)) {
        logger.debug(`Making ${tmpDir}`);
        fs.mkdirSync(tmpDir);
    }

    let book;
    const archived_json = `${tmpDir}/${isbn}.json`;

    
    if (!program.compile || !fs.existsSync(archived_json)) {
        book = await getInfo(isbn);
        fs.writeFileSync(archived_json, JSON.stringify(book))
    } else {
        let saved_info = fs.readFileSync(archived_json, 'utf8');
        book = JSON.parse(saved_info);
    }
    printInfo(book);
    
    book.downloadFrom = 1;
    book.downloadTo = book.pages.length;

    if (program.range) {
        logger.debug(`Parsing ${program.range} as range`);
        let strings = program.range.split('-');
        if (strings.length != 2) {
            logger.error(`${program.range} is not a valid range`);
            process.exit(-1);
        } else {
            if (!isNaN(strings[0]) && parseInt(strings[0]) > 0) {
                book.downloadFrom = parseInt(strings[0]);
                logger.debug('First page to download is page no. ' + book.downloadFrom);
            }
            if (!isNaN(strings[1]) && parseInt(strings[1]) <= book.downloadTo) {
                book.downloadTo = parseInt(strings[1]);
                logger.debug('Last page to download is page no. ' + book.downloadTo);
            }
        }
    }

    if (program.test) {
        book.downloadFrom = 1;
        book.downloadTo = 10;
    }

    if (program.getInfo) {
        process.exit();
    }

    var outputDir = './pdf/';
    const PDFMerger = require('pdf-merger-js');
    const merger = new PDFMerger();

    if (program.compile) {
        logger.info('Compiling already downloaded pages');
        logger.debug(`Listing files in ${tmpDir}`);
        const path = require('path');
        const files = fs.readdirSync(tmpDir);
        const pdfs = files.filter(file => path.extname(file) === '.pdf');
        pdfs.forEach(pdf => {
            logger.debug(`Deleting all ${pdf}`);
            fs.unlinkSync(tmpDir + '/' + pdf);
        });
        const backgrounds = files.filter(file => path.extname(file) === '.jpg');
        backgrounds.forEach(bg => {
            const paddedPageNumber = bg.substr(14, 4);
            const pageNumber = parseInt(paddedPageNumber);
            const background_filename = `${tmpDir}/${bg}`;
            let foreground_filename = `${tmpDir}/${book.isbn}-${paddedPageNumber}-fg.svg`;
            logger.debug(`Lo sfondo per la pagina n. ${pageNumber} è: ${background_filename}`);
            logger.debug(`Il testo per la pagina n. ${pageNumber} è: ${foreground_filename}`);
            if (!fs.existsSync(foreground_filename)) {
                logger.debug('Questa pagina non ha testo');
                foreground_filename = false;
            }
            merge(book, merger, pageNumber, foreground_filename, background_filename);
        });
        
        const finalPdf = outputDir + `${Date.now()} - ${book.title}.pdf`;
        logger.debug(`Saving the final PDF as ${finalPdf}`);
        await merger.save(finalPdf);
    } else {
        logger.info('Downloading');
        await getFiles(book, merger);

        if (!program.download || !program.single) {
            logger.info('Merging all pages into one');
            if (!fs.existsSync(outputDir)) {
                logger.debug(`Making ${outputDir}`);
                fs.mkdirSync(outputDir);
            }
            const finalPdf = outputDir + `${Date.now()} - ${book.title}.pdf`;
            logger.debug(`Saving the final PDF as: ${finalPdf}`);
            await merger.save(finalPdf);
        }

        if (program.purge) {
            const numberOfFolders = fs.readdirSync(tmpRootDir).length;
            const delDir = tmpRootDir;
            logger.info('Deleting all temporary files');
            logger.debug(`There are ${numberOfFolders} files inside ${delDir}`);
            if (numberOfFolders > 1) {
                logger.debug(`I'll delete the files regarding ${book.isbn}`);
                delDir = tmpRootDir + book.isbn;
            }
            try {
                logger.debug(`Deleting ${delDir}`);
                await del(delDir);
            } catch (err) {
                logger.error(`There was an errore while deleting ${delDir}.`);
            }
        }
    }
    logger.info('Done. ;)');
    process.exit();
}

async function getInfo(isbn) {
    let book = {
        isbn: isbn
    }

    book.sources = {
        toc: `https://www.edravet.it/fb/${book.isbn}/files/assets/html/workspace.js`,
        pages: `https://www.edravet.it/fb//${book.isbn}/files/assets/common/pager.js`,
        mock: '?uni=6d7e16ec9967fedf470bc3615dd9e193'
    }

    const options = {
        headers: {
            'Content-Type': 'application/javascript',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:73.0) Gecko/20100101 Firefox/73.0'
        }
    };

    logger.debug(`Downloading TOC from ${book.sources.toc}`);
    let response = await fetch(book.sources.toc, options);
    let data = await response.json();
    book.title = data.title;

    logger.debug(`Downloading page list from ${book.sources.pages}`);
    response = await fetch(book.sources.pages + book.sources.mock, options);
    data = await response.json();
    const px2mm = 2.83;
    book.size = data.bookSize;
    book.realSize = {}
    book.realSize.width = Math.ceil(book.size.width / px2mm);
    book.realSize.height = Math.ceil(book.size.height / px2mm);
    let pages = data.pages;
    // delete pages['defaults'];
    delete pages['structure'];
    book.pages = []
    for (let number in pages) {
        let hasText = data.pages.defaults.textLayer;
        let isVector = data.pages.defaults.vectorText;

        if (pages[number].hasOwnProperty('textLayer')) {
            hasText = pages[number].textLayer;
        }
        if (pages[number].hasOwnProperty('vectorText')) {
            isVector = pages[number].vectorText;
        }

        let page = {
            'number': number,
            'hasText': hasText,
            'isVector': isVector
        }

        book.pages.push(page);
    }

    return book;
}

async function getFiles(book, merger) {
    let tmpRootDir = './tmp/';
    let tmpDir = tmpRootDir + book.isbn;
    const options = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:81.0) Gecko/20100101 Firefox/81.0'
        }
    };

    logger.info(`Downloading ${book.isbn} from page no. ${book.downloadFrom} to page no. ${book.downloadTo}`);

    for (let i = book.downloadFrom - 1; i < book.downloadTo; i++) {
        logger.info(`Downloading page no. ${book.pages[i].number} di ${book.downloadTo}`);

        let foreground_url;
        let background_url;
        let foreground_filename;
        
        if (book.pages[i].isVector) {
            foreground_url = `https://www.edravet.it/fb/${book.isbn}/files/assets/common/page-vectorlayers/${pad(4, book.pages[i].number, '0')}.svg`;
            background_url = `https://www.edravet.it/fb/${book.isbn}/files/assets/common/page-html5-substrates/page${pad(4, book.pages[i].number, '0')}_4.jpg`;
            foreground_filename = `${book.isbn}-${pad(4, book.pages[i].number, '0')}-fg.svg`;
        } else {
            foreground_url = `https://www.edravet.it/fb/${book.isbn}/files/assets/common/page-textlayers/page${pad(4, book.pages[i].number, '0')}_l1.png`;
            background_url = `https://www.edravet.it/fb/${book.isbn}/files/assets/common/page-html5-substrates/page${pad(4, book.pages[i].number, '0')}_l.jpg`;
            foreground_filename = `${book.isbn}-${pad(4, book.pages[i].number, '0')}-fg.png`;
        }
        
        const background_filename = `${book.isbn}-${pad(4, book.pages[i].number, '0')}-bg.jpg`;
        const foreground_path = `${tmpDir}/${foreground_filename}`;
        const background_path = `${tmpDir}/${background_filename}`;
        
        logger.debug('Downloading the background layer');
        if (!program.dryRun) {
            logger.debug(`Background URL is: ${background_url}`);
            await fetch(background_url, options)
                .then(res => {
                    const dest = fs.createWriteStream(background_path);
                    res.body.pipe(dest);
                });
        }

        if (book.pages[i].hasText) {
            logger.debug('Downloading the foreground layer');
            logger.debug(`Foreground URL is: ${foreground_url}`);
            if (book.pages[i].isVector) {
                logger.debug('Foreground is vectorial.');
                await fetch(foreground_url, options)
                    .then(res => res.text())
                    .then(body => {
                        const dest = fs.writeFile(foreground_path, body, (err) => {
                            if (err) throw err;
                        });
                    })
                    .catch(err => console.log(err));
            } else {
                logger.debug('Foreground is raster.');
                await fetch(foreground_url, options)
                .then(res => {
                    const dest = fs.createWriteStream(foreground_path);
                    res.body.pipe(dest);
                });
            }
        } else {
            logger.debug(`Page no. ${book.pages[i].number} has no foreground layer`);
        }

        if (!program.download) {
            const background = background_path;
            const foreground = book.pages[i].hasText ? foreground_path : false;
            await merge(book, merger, book.pages[i].number, foreground, background);
        }

        if (!program.fullSpeed && !(i % 2) && (i != (book.downloadTo - 1))) {
            await pause(false);
        }
    }
}

function pause(length) {
    let ms;
    if (length === false) {
        ms = Math.random() * (8000 - 2000) + 2000;
        logger.info(`Waiting for ${Math.round(ms / 1000)} seconds`);
    } else {
        ms = length;
    }
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function merge(book, merger, pageNumber, foreground_filename, background_filename) {
    const isbn = book.isbn;
    const pageSize = book.realSize;
    logger.info(`Compiling page no. ${pageNumber}`);
    const Puppeteer = require('puppeteer');

    const tmpDir = './tmp';
    const filePath = `${tmpDir}/${isbn}/${isbn}_${pad(4, pageNumber, '0')}.pdf`;

    logger.debug('Looking for the files')
    do {
        logger.debug(`Waiting for page no. ${pageNumber} background layer...`);
        await pause(500);
        var background_exists = fs.existsSync(background_filename);
        do {
            var foreground_exists = false;
            if (foreground_filename === false) {
                logger.debug(`Page no. ${pageNumber} has no foreground layer.`);
                break;
            } else {
                logger.debug(`Waiting for page no. ${pageNumber} foreground layer...`);
                await pause(500);
                foreground_exists = fs.existsSync(foreground_filename);
            }
        } while (!foreground_exists); 
    } while (!background_exists);

    logger.debug(`Got everything for page no. ${pageNumber}`);

    let background_content;
    let foreground_content;
    let template;

    if (book.pages[pageNumber].isVector) {
        background_content = fs.readFileSync(background_filename, {
            encoding: 'base64'
        });
        if (foreground_filename !== false) {
            foreground_content = fs.readFileSync(foreground_filename, {
                encoding: 'base64'
            });
        } else {
            foreground_content = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIHZpZXdCb3g9IjAgMCA1IDUiIGZpbGwtcnVsZT0iZXZlbm9kZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgc3Ryb2tlLW1pdGVybGltaXQ9IjIiLz4=';
        }
        template = `<html><body style="margin:0"><div style="background-image: url(data:image/jpg;base64,${background_content});background-size: 100%;"><img src="data:image/svg+xml;base64,${foreground_content}" style="width:100%"></div></body></html>`;
    } else {
        background_content = fs.readFileSync(background_filename, {
            encoding: 'base64'
        });
        if (foreground_filename !== false) {
            foreground_content = fs.readFileSync(foreground_filename, {
                encoding: 'base64'
            });
        } else {
            foreground_content = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';
        }
        template = `<html><body style="margin:0"><div style="background-image: url(data:image/jpg;base64,${background_content});background-size: 100%;"><img src="data:image/png;base64,${foreground_content}" style="width:100%"></div></body></html>`;
    }

    const browser = await Puppeteer.launch();
    const page = await browser.newPage();
    await page.setContent(template);
    logger.debug('Printing the page as PDF')
    await page.pdf({
        path: filePath,
        width: `${pageSize.width}mm`,
        height: `${pageSize.height}mm`,
        pageRanges: '1',
        printBackground: true
    });

    if (!program.single) {
        logger.debug('Adding the page to the final PDF')
        merger.add(filePath);
    }

    await browser.close();
};

function printInfo(book) {
    console.log(`Title: ${book.title}`);
    console.log(`ISBN: ${book.isbn}`);
    console.log(`Number of pages: ${book.pages.length}`);
    console.log(`Page size in pixels: ${book.size.width}×${book.size.height}`);
    console.log(`Estimated page size in millimetres: ${book.realSize.width}×${book.realSize.height}`)
}