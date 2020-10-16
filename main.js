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

    logger.debug('Impostazione di Program');

    program
        .version('1.2.0')
        .requiredOption('-i, --isbn [codice ISBN]', 'ISBN del libro')
        .option('-o, --ottieni-info', 'Scaricamento e stampa delle informazioni del libro')
        .option('-b, --tutta-birra', 'Nesuna pausa tra gli scaricamenti')
        .option('-t, --test', 'Scarica e produci un PDF delle prime quattro (4) pagine')
        .option('-f, --fingi', 'Non scaricare nulla')
        .option('-s, --scarica', 'Scarica le pagine, ma non produrre un PDF')
        .option('-p, --pulisci', 'Pulisci la cartella temporane alla fine del processo')
        .option('-c, --compila', 'Produci un PDF dalle pagine precedentemente scaricate')
        .option('-v, --verboso', 'Mostra debug');

    program.parse(process.argv);

    if ((program.fingi && program.scarica) || (program.compila && program.scarica)) {
        logger.error('Le opzioni non sono compatibili, pirla.');
        process.exit(1);
    }

    let isbn = program.isbn;
    if (program.verboso) {
        logger.level = 'debug';
        console.log(program.opts());
    }

    logger.info(`Cerco le informazioni per ${isbn}`);
    
    const tmpRootDir = './tmp/';
    if (!fs.existsSync(tmpRootDir)) {
        logger.debug(`Creo ${tmpRootDir}`);
        fs.mkdirSync(tmpRootDir);
    }
    const tmpDir = tmpRootDir + isbn;
    if (!fs.existsSync(tmpDir)) {
        logger.debug(`Creo ${tmpDir}`);
        fs.mkdirSync(tmpDir);
    }

    let book;
    const archived_json = `${tmpDir}/${isbn}.json`;
    if (!program.compila || !fs.existsSync(archived_json)) {
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

    if (program.compila) {
        logger.info('Compila le pagine già scaricate in un nuovo PDF');
        logger.debug(`Elenco i file in ${tmpDir}`);
        const path = require('path');
        const files = fs.readdirSync(tmpDir);
        const pdfs = files.filter(file => path.extname(file) === '.pdf');
        pdfs.forEach(pdf => {
            logger.debug(`Elimino tutti i ${pdf}`);
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
        logger.debug(`Salvo il PDF finale come: ${finalPdf}`);
        await merger.save(finalPdf);
    } else {
        logger.info('Inizio lo scaricamento dei file');
        await getFiles(book, merger);

        if (!program.scarica) {
            logger.info('Unisco tutte le pagine in una sola');
            if (!fs.existsSync(outputDir)) {
                logger.debug(`Creo ${outputDir}`);
                fs.mkdirSync(outputDir);
            }
            const finalPdf = outputDir + `${Date.now()} - ${book.title}.pdf`;
            logger.debug(`Salvo il PDF finale ocme: ${finalPdf}`);
            await merger.save(finalPdf);
        }

        if (program.pulisci) {
            const numberOfFolders = fs.readdirSync(tmpRootDir).length;
            const delDir = tmpRootDir;
            logger.info('Elimino i file temporanei');
            logger.debug(`Ci sono ${numberOfFolders} file dentro ${delDir}`);
            if (numberOfFolders > 1) {
                logger.debug(`Cancellerò solamente la cartella dedicata a ${book.isbn}`);
                delDir = tmpRootDir + book.isbn;
            }
            try {
                logger.debug(`Elimino ${delDir}`);
                await del(delDir);
            } catch (err) {
                logger.error(`C'è stato un errore nell'eliminazione di ${delDir}.`);
            }
        }
    }
    logger.info('Fatto. ;)');
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

    logger.debug(`Scaricamento TOC da ${book.sources.toc}`);
    let response = await fetch(book.sources.toc + book.sources.mock, options);
    let data = await response.json();
    book.title = data.title;

    logger.debug(`Scaricamento della lista delle pagine da ${book.sources.pages}`);
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
    let tmpRootDir = './tmp/';
    let tmpDir = tmpRootDir + book.isbn;
    const options = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:81.0) Gecko/20100101 Firefox/81.0'
        }
    };

    const lastPage = program.test ? 4 : book.pages.length;

    for (let i = 0; i < lastPage; i++) {
        logger.info(`Scarico la pagina n. ${book.pages[i].number} di ${lastPage}`);
        const foreground_url = `https://www.edravet.it/fb/${book.isbn}/files/assets/common/page-vectorlayers/${pad(4, book.pages[i].number, '0')}.svg`;
        const background_url = `https://www.edravet.it/fb/${book.isbn}/files/assets/common/page-html5-substrates/page${pad(4, book.pages[i].number, '0')}_4.jpg`;
        const foreground_filename = `${book.isbn}-${pad(4, book.pages[i].number, '0')}-fg.svg`;
        const background_filename = `${book.isbn}-${pad(4, book.pages[i].number, '0')}-bg.jpg`;
        const foreground_path = `${tmpDir}/${foreground_filename}`;
        const background_path = `${tmpDir}/${background_filename}`;

        logger.debug('Scarico lo sfondo');
        if (!program.dryRun) {
            await fetch(background_url + book.sources.mock, options)
                .then(res => {
                    const dest = fs.createWriteStream(background_path);
                    res.body.pipe(dest);
                });
        }

        if (book.pages[i].hasText) {
            logger.debug('Scarico il testo');
            await fetch(foreground_url + book.sources.mock, options)
                .then(res => res.text())
                .then(body => {
                    const dest = fs.writeFile(foreground_path, body, (err) => {
                        if (err) throw err;
                    });
                })
                .catch(err => console.log(err));
        } else {
            logger.debug(`La pagina n. ${book.pages[i].number} non ha testo`);
        }

        if (!program.scarica) {
            const background = background_path;
            const foreground = book.pages[i].hasText ? foreground_path : false;
            await merge(book, merger, book.pages[i].number, foreground, background);
        }

        if (!program.tuttaBirra && (i != (lastPage - 1))) {
            await pausa(false);
        }
    }
}

function pausa(durata) {
    let ms;
    if (durata === false) {
        ms = Math.random() * (8000 - 2000) + 2000;
        logger.info(`Resto in attesa per ${Math.round(ms / 1000)} secondi`);
    } else {
        ms = durata;
    }
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function merge(book, merger, pageNumber, foreground_filename, background_filename) {
    const isbn = book.isbn;
    const pageSize = book.realSize;
    logger.info(`Produco la pagina n. ${pageNumber}`);
    const Puppeteer = require('puppeteer');

    const tmpDir = './tmp';
    const filePath = `${tmpDir}/${isbn}/${isbn}_${pad(4, pageNumber, '0')}.pdf`;

    logger.debug('Cerco i file')
    do {
        logger.debug(`In attesa dello sfondo per la pagina n. ${pageNumber}...`);
        await sleep(500);
        var background_exists = fs.existsSync(background_filename);
        do {
            var foreground_exists = false;
            if (foreground_filename === false) {
                logger.debug(`La pagina n. ${pageNumber} non ha testo.`);
                break;
            } else {
                logger.debug(`In attesa del testo per la pagina n. ${pageNumber}...`);
                await sleep(500);
                foreground_exists = fs.existsSync(foreground_filename);
            }
        } while (!foreground_exists); 
    } while (!background_exists);

    logger.debug(`Ho tutto per la pagina n. ${pageNumber}`);

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
    logger.debug('Stampo la pagina come PDF')
    await page.pdf({
        path: filePath,
        width: `${pageSize.width}mm`,
        height: `${pageSize.height}mm`,
        pageRanges: '1',
        printBackground: true
    });

    logger.debug('Aggiungo la pagina al PDF finale')
    merger.add(filePath);

    await browser.close();
};

function printInfo(book) {
    console.log(`Titolo: ${book.title}`);
    console.log(`ISBN: ${book.isbn}`);
    console.log(`Numero di pagine: ${book.pages.length}`);
    console.log(`Dimensione della pagina (px): ${book.size.width}×${book.size.height}`);
    console.log(`Stima delle dimensioni reali (mm): ${book.realSize.width}×${book.realSize.height}`)
}