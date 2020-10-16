// Copyright (c) 2020 Jacopo Donati
// 
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

"use strict";

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

    logger.debug('Setting up Program');

    program
        .version('1.1.0')
        .requiredOption('-i, --isbn [ISBN code]', 'ISBN del libro')
        .option('-g, --get-info', 'Download and output book info')
        .option('-f, --full-speed', 'Don\'t wait between page downloads')
        .option('-t, --test-run', 'Download and merge the first 4 pages')
        .option('-d, --dry-run', 'Don\'t download any page')
        .option('-p, --purge', 'Delete temporary files upon completion')
        .option('-c, --compile', 'Output a PDF from previously downloaded pages')
        .option('-v, --verbose', 'Show debug');

    program.parse(process.argv);

    let isbn = program.isbn;
    if (program.verbose) {
        logger.level = 'debug';
        console.log(program.opts());
    }

    logger.info(`Getting info for ${isbn}`);
    
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

    if (program.getInfo) {
        process.exit();
    }

    var outputDir = './pdf/';
    const PDFMerger = require('pdf-merger-js');
    const merger = new PDFMerger();

    if (program.compile) {
        logger.info('Compiling the PDF from already downloaded files');
        logger.debug(`Listing files for ${tmpDir}`);
        const path = require('path');
        const files = fs.readdirSync(tmpDir);
        const pdfs = files.filter(file => path.extname(file) === '.pdf');
        pdfs.forEach(pdf => {
            logger.debug(`Deleting ${pdf}`);
            fs.unlinkSync(tmpDir + '/' + pdf);
        });
        const backgrounds = files.filter(file => path.extname(file) === '.jpg');
        backgrounds.forEach(bg => {
            let paddedPageNumber = bg.substr(14, 4);
            let pageNumber = parseInt(paddedPageNumber);
            let background_filename = `${tmpDir}/${bg}`;
            let foreground_filename = `${tmpDir}/${book.isbn}-${paddedPageNumber}-fg.svg`;
            logger.debug(`Background for page ${pageNumber} is ${background_filename}`);
            logger.debug(`Foreground for page ${pageNumber} is ${foreground_filename}`);
            if (!fs.existsSync(foreground_filename)) {
                logger.debug('Foreground does not exist');
                foreground_filename = false;
            }
            merge(book, merger, pageNumber, foreground_filename, background_filename);
        });
        
        let finalPdf = outputDir + `${Date.now()} - ${book.title}.pdf`;
        logger.debug(`Saving the final PDF as: ${finalPdf}`);
        await merger.save(finalPdf);
    } else {
        logger.info('Starting file download');
        await getFiles(book, merger);

        logger.info('Merging all pages into one');
        if (!fs.existsSync(outputDir)) {
            logger.debug(`Making ${outputDir}`);
            fs.mkdirSync(outputDir);
        }
        let finalPdf = outputDir + `${Date.now()} - ${book.title}.pdf`;
        logger.debug(`Saving the final PDF as: ${finalPdf}`);
        await merger.save(finalPdf);

        if (program.purge) {
            var numberOfFolders = fs.readdirSync(tmpRootDir).length;
            var delDir = tmpRootDir;
            logger.info('Removing temporary files');
            logger.debug(`There are ${numberOfFolders} file(s) inside ${delDir}`);
            if (numberOfFolders > 1) {
                logger.debug('I\'ll just delete this book temporary folder');
                delDir = tmpRootDir + book.isbn;
            }
            try {
                logger.debug(`Deleting ${delDir}`);
                await del(delDir);
            } catch (err) {
                logger.error(`Error while deleting ${delDir}.`);
            }
        }
    }
    logger.info('Done.');
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
    let response = await fetch(book.sources.toc + book.sources.mock, options);
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
    delete pages['defaults'];
    delete pages['structure'];
    book.pages = []
    for (let number in pages) {
        let hasText = false;
        if (pages[number].hasOwnProperty('textLayer')) {
            hasText = true;
        }
        let page = {
            'number': number,
            'hasText': hasText
        }
        book.pages.push(page);
    }

    return book;
}

async function getFiles(book, merger) {
    var tmpRootDir = './tmp/';
    var tmpDir = tmpRootDir + book.isbn;
    var options = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:81.0) Gecko/20100101 Firefox/81.0'
        }
    };

    var lastPage = book.pages.length;
    if (program.testRun) {
        lastPage = 4;
    }

    for (var i = 0; i < lastPage; i++) {
        logger.info(`Downloading page no. ${book.pages[i].number} of ${lastPage}`);
        var foreground_url = `https://www.edravet.it/fb/${book.isbn}/files/assets/common/page-vectorlayers/${pad(4, book.pages[i].number, '0')}.svg`;
        var background_url = `https://www.edravet.it/fb/${book.isbn}/files/assets/common/page-html5-substrates/page${pad(4, book.pages[i].number, '0')}_4.jpg`;
        var foreground_filename = `${book.isbn}-${pad(4, book.pages[i].number, '0')}-fg.svg`;
        var background_filename = `${book.isbn}-${pad(4, book.pages[i].number, '0')}-bg.jpg`;
        var foreground_path = `${tmpDir}/${foreground_filename}`;
        var background_path = `${tmpDir}/${background_filename}`;

        logger.debug('Downloading the background');
        if (!program.dryRun) {
            await fetch(background_url + book.sources.mock, options)
                .then(res => {
                    const dest = fs.createWriteStream(background_path);
                    res.body.pipe(dest);
                });
        }

        if (book.pages[i].hasText) {
            logger.debug('Downloading the text');
            await fetch(foreground_url + book.sources.mock, options)
                .then(res => res.text())
                .then(body => {
                    const dest = fs.writeFile(foreground_path, body, (err) => {
                        if (err) throw err;
                    });
                })
                .catch(err => console.log(err));
        } else {
            logger.debug(`Page no. ${book.pages[i].number} has no text`);
        }

        var background = background_path;
        var foreground = book.pages[i].hasText ? foreground_path : false;

        await merge(book, merger, book.pages[i].number, foreground, background);

        if (!program.fullSpeed && (i != lastPage)) {
            await sleep(false);
        }
    }
}

function sleep(length) {
    var ms;
    if (length === false) {
        ms = Math.random() * (8000 - 2000) + 2000;
        logger.info(`Pausing for ${Math.round(ms / 1000)} seconds`);
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
    logger.info(`Merging page n. ${pageNumber}`);
    const Puppeteer = require('puppeteer');

    const tmpDir = './tmp';
    const filePath = `${tmpDir}/${isbn}/${isbn}_${pad(4, pageNumber, '0')}.pdf`;

    logger.debug('Looking for the files')
    do {
        logger.debug(`Waiting for the background of page n. ${pageNumber}...`);
        await sleep(500);
        var background_exists = fs.existsSync(background_filename);
        do {
            var foreground_exists = false;
            if (foreground_filename === false) {
                logger.debug(`Page n. ${pageNumber} has no foreground.`);
                break;
            } else {
                logger.debug(`Waiting for the foreground of page n. ${pageNumber}...`);
                await sleep(500);
                foreground_exists = fs.existsSync(foreground_filename);
            }
        } while (!foreground_exists); 
    } while (!background_exists);

    logger.debug(`Got everything for page n. ${pageNumber}`);

    const background_content = fs.readFileSync(background_filename, {
        encoding: 'base64'
    });
    let foreground_content;
    if (foreground_filename !== false) {
        foreground_content = fs.readFileSync(foreground_filename, {
            encoding: 'base64'
        });
    } else {
        foreground_content = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIHZpZXdCb3g9IjAgMCA1IDUiIGZpbGwtcnVsZT0iZXZlbm9kZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgc3Ryb2tlLW1pdGVybGltaXQ9IjIiLz4=';
    }

    const template = `<html><body style="margin:0"><div style="background-image: url(data:image/jpg;base64,${background_content});background-size: 100%;"><img src="data:image/svg+xml;base64,${foreground_content}" style="width:100%"></div></body></html>`;
    // const template = `<html><body style="margin:0"><div style="width:100%;height:100%;background:url(data:image/svg+xml;base64,${foreground_content}),url(data:image/jpg;base64,${background_content});background-size:100%,100%"></div></body></html>`;

    const browser = await Puppeteer.launch();
    const page = await browser.newPage();
    await page.setContent(template);
    logger.debug('Saving the page as PDF')
    await page.pdf({
        path: filePath,
        width: `${pageSize.width}mm`,
        height: `${pageSize.height}mm`,
        pageRanges: '1',
        printBackground: true
    });

    logger.debug('Adding the page to the final PDF')
    merger.add(filePath);

    await browser.close();
};

function printInfo(book) {
    console.log(`Title: ${book.title}`);
    console.log(`ISBN: ${book.isbn}`);
    console.log(`No. of pages: ${book.pages.length}`);
    console.log(`Page size (px): ${book.size.width}×${book.size.height}`);
    console.log(`Estimated page size (mm): ${book.realSize.width}×${book.realSize.height}`)
}