// Copyright (c) 2020 Jacopo Donati
// 
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

"use strict";

process.binding('http_parser').HTTPParser = require('http-parser-js').HTTPParser;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Imposto le dipendenze
const winston = require('winston')
const commander = require('commander');
const program = new commander.Command();
const fetch = require('node-fetch');
const fs = require('fs');
const pad = require('pad');
const del = require('del');
const ProgressBar = require('progress');

main();

async function main() {
    // Imposto il logger
    global.logger = winston.createLogger({
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

    // Imposto i parametri
    program
        .version('1.4.0')
        .requiredOption('-i, --isbn [ISBN code]', 'Codice ISBN del libro da scaricare')
        .option('-I, --get-info', 'Scarica e mostra le informazioni del libro')
        .option('-f, --full-speed', 'Non aspettare tra il download di una pagina e quella successiva')
        .option('-t, --test', 'Scarica e compila le prime quattro pagine')
        .option('-d, --dry-run', 'Non scaricare nulla')
        .option('-D, --download', 'Scarica le pagine senza compilarle')
        .option('-r, --range <range>', 'Scarica l\'intervallo selezionato. L\'intervallo è formattato come "inizio-fine" (per es. 21-34).  "inizio-" e "-fine" sono validi.')
        .option('-p, --purge', 'Rimuovi i file temporanei dopo il download')
        .option('-c, --compile', 'Compila un PDF dalle pagine precedentemente scaricate')
        .option('-s, --single', 'Compila un PDF per ogni pagina')
        .option('-v, --verbose', 'Mostra più informazioni');

    // Processo i parametri
    program.parse(process.argv);

    // Se ci sono opzioni non compatibili, esco
    if (
        (program.dryRun !== undefined && program.download !== undefined) ||
        (program.compile !== undefined && program.download !== undefined)
    ) {
        logger.error('Le opzioni non sono compatibili.');
        process.exit(1);
    }

    // Se è impostata la verbosità, elevo il livello del logger per mostrare i messaggi di debug
    if (program.verbose !== undefined) {
        logger.level = 'debug';
        logger.debug(program.opts());
    }

    let isbn = program.isbn;
    global.tmpRootDir = './tmp/';
    global.tmpDir = tmpRootDir + isbn;
    const archived_json = `${tmpDir}/${isbn}.json`;

    // Se non esistono, creo le cartelle temporanee necessarie
    if (!fs.existsSync(tmpRootDir)) {
        logger.debug(`Creo ${tmpRootDir}`);
        fs.mkdirSync(tmpRootDir);
    }
    if (!fs.existsSync(tmpDir)) {
        logger.debug(`Creo ${tmpDir}`);
        fs.mkdirSync(tmpDir);
    }

    // Se l'indice non è presente, lo scarico.
    logger.debug(`Cerco ${isbn}`);
    if (program.compile === undefined || !fs.existsSync(archived_json)) {
        global.book = await getInfo(isbn);
        fs.writeFileSync(archived_json, JSON.stringify(book))
    } else {
        let saved_info = fs.readFileSync(archived_json, 'utf8');
        global.book = JSON.parse(saved_info);
    }

    // Se è impostata la verbosità, stampa le informazioni del libro
    if (program.verbose !== undefined || program.getInfo !== undefined) {
        printInfo(global.book);

        // Se sono richieste solamente le informazioni, posso uscire.
        if (program.getInfo) {
            process.exit();
        }
    }

    // Imposto gli strumenti per la creazione dei PDF
    global.outputDir = './pdf/';
    const PDFMerger = require('pdf-merger-js');
    global.merger = new PDFMerger();

    // Se è richiesta la compilazione, inizio la routine necessaria
    if (program.compile !== undefined) {
        await compile();
    } else {
        // Inizio la routine per scaricare i file
        await getFiles();

        // A meno che non sia richiesto il solo scaricamento o la
        // compilazione delle singole pagine, compilo un PDF finale
        if (program.download === undefined || program.single === undefined) {
            logger.debug('Compilo le pagine in una unica');
            if (!fs.existsSync(outputDir)) {
                logger.debug(`Creo ${outputDir}`);
                fs.mkdirSync(outputDir);
            }
            let range = '';
            if (program.range) {
                range = ` - ${program.range}`;
            }
            const finalPdf = outputDir + `${Date.now()} - ${book.title}${range}.pdf`;
            logger.debug(`Salvo il PDF finale come: ${finalPdf}`);
            await merger.save(finalPdf);
        }

        // Se richiesto, elimino i file temporanei
        if (program.purge !== undefined) {
            const numberOfFolders = fs.readdirSync(tmpRootDir).length;
            let delDir = tmpRootDir;
            logger.debug('Cancello i file temporanei');
            logger.debug(`Ci sono ${numberOfFolders} file dentro ${delDir}`);
            if (numberOfFolders > 1) {
                logger.debug(`Cancellerò solo i file riguardanti ${book.isbn}`);
                delDir = tmpRootDir + book.isbn;
            }
            try {
                logger.debug(`Cancello ${delDir}`);
                del(delDir);
            } catch (err) {
                logger.error(`C'è stato un errore nella cancellazione di ${delDir}.`);
            }
        }
    }

    // Esco
    logger.debug('Fatto. ;)');
    process.exit();
}

async function compile() {
    logger.debug('Compilo le pagine già scaricate');
    logger.debug(`Elenco i file in ${tmpDir}`);

    // Ottengo l'elenco dei file nella cartella temporanea
    const path = require('path');
    const files = fs.readdirSync(tmpDir);

    // Elimino tutti i vecchi PDF
    const pdfs = files.filter(file => path.extname(file) === '.pdf');
    for (const pdf of pdfs) {
        logger.debug(`Cancello tutti i PDF vecchi ${pdf}`);
        fs.unlinkSync(tmpDir + '/' + pdf);
    }

    // Ottengo l'elenco degli sfondi delle pagine e inizio a compilarli
    const backgrounds = files.filter(file => path.extname(file) === '.jpg');

    // Se non è impostata la verbosità, mostrerò la barra di progresso
    if (program.verbose === undefined) {
        global.compilationBar = new ProgressBar('Compilo pag. :current di :total [:bar] :percent', {
            total: backgrounds.length
        });
    }

    let i = 1;
    for (const background of backgrounds) {
        if (
            (program.test !== undefined) &&
            (i === 10)
        ) {
            break;
        } else {
            i = i + 1;
        }
        const paddedPageNumber = background.substr(14, 4);
        const pageNumber = parseInt(paddedPageNumber);
        const background_filename = `${tmpDir}/${background}`;
        let foreground_filename = `${tmpDir}/${book.isbn}-${paddedPageNumber}-fg.svg`;
        logger.debug(`Lo sfondo per la pagina n. ${pageNumber} è: ${background_filename}`);
        logger.debug(`Il testo per la pagina n. ${pageNumber} è: ${foreground_filename}`);
        if (!fs.existsSync(foreground_filename)) {
            logger.debug('Questa pagina non ha testo');
            foreground_filename = false;
        }
        await merge(pageNumber, foreground_filename, background_filename);
        compilationBar.tick();
    }
    
    const finalPdf = outputDir + `${Date.now()} - ${book.title}.pdf`;
    logger.debug(`Salvo il PDF finale come ${finalPdf}`);
    if (program.single === undefined) {
        await merger.save(finalPdf);
    }
}

async function getInfo(isbn) {
    // Imposto le informazioni di base del libro
    let tmpBook = {
        isbn: isbn,
        sources: {
            toc: `https://www.edravet.it/fb/${isbn}/files/assets/html/workspace.js`,
            pages: `https://www.edravet.it/fb/${isbn}/files/assets/common/pager.js`,
            mock: '?uni=6d7e16ec9967fedf470bc3615dd9e193'
        }
    }

    // Imposto le opzioni per lo scaricamento degli indici
    const options = {
        headers: {
            'Content-Type': 'application/javascript',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:73.0) Gecko/20100101 Firefox/73.0'
        }
    };

    // Scarico l'indice
    logger.debug(`Scarico il primo indice da ${tmpBook.sources.toc}`);
    let response = await fetch(tmpBook.sources.toc, options)
        .catch(error => {
            logger.error(`Si è verificato un problema con il download di ${tmpBook.sources.toc}`);
        });
    let data = await response.json();
    tmpBook.title = data.title;

    // Scarico l'elenco delle pagine
    logger.debug(`Scarico l'elenco delle pagine da ${tmpBook.sources.pages}`);
    response = await fetch(tmpBook.sources.pages + tmpBook.sources.mock, options)
        .catch(error => {
            logger.error(`Si è verificato un problema con il download di ${tmpBook.sources.pages}`);
        });
    data = await response.json();

    // Imposto le dimensioni delle pagine
    const px2mm = 1;//2.83;
    tmpBook.size = data.bookSize;
    tmpBook.realSize = {}
    tmpBook.realSize.width = Math.ceil(data.bookSize.width / px2mm);
    tmpBook.realSize.height = Math.ceil(data.bookSize.height / px2mm);

    // Copio le informazioni delle singole pagine
    let pages = data.pages;
    delete pages['structure'];
    tmpBook.pages = []
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

        tmpBook.pages.push(page);
    }

    return tmpBook;
}

async function getFiles() {
    // Imposto la prima e l'ultima pagina di default...
    book.downloadFrom = 1;
    book.downloadTo = book.pages.length;
    // ...e le correggo se sono stati impostati degli intervalli di scaricamento...
    if (program.range !== undefined) {
        logger.debug(`Elaboro ${program.range} come intervallo`);
        let strings = program.range.split('-');
        if (strings.length !== 2) {
            logger.error(`${program.range} non è un intervallo valido`);
            process.exit(-1);
        } else {
            if (!isNaN(strings[0]) && parseInt(strings[0]) > 0) {
                book.downloadFrom = parseInt(strings[0]);
                logger.debug('La prima pagina da scaricare è la n. ' + book.downloadFrom);
            }
            if (!isNaN(strings[1]) && parseInt(strings[1]) <= book.downloadTo) {
                book.downloadTo = parseInt(strings[1]);
                logger.debug('L\'ultima pagina da scaricare è la n. ' + book.downloadTo);
            }
        }
    }
    // ...o se è impostato lo scaricamento di prova.
    if (program.test !== undefined) {
        book.downloadFrom = 1;
        book.downloadTo = 10;
    }

    // Se non è impostata la verbosità, mostrerò la barra di progresso
    if (program.verbose === undefined) {
        global.downloadBar = new ProgressBar('Scarico pag. :current di :total [:bar] :percent', {
            total: (book.downloadTo - book.downloadFrom) + 1
        });
    }

    // Imposto gli header per il download
    const options = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:81.0) Gecko/20100101 Firefox/81.0'
        }
    };

    logger.debug(`Scarico ${book.isbn} da pag. ${book.downloadFrom} a pag. ${book.downloadTo}`);

    for (let i = book.downloadFrom - 1; i < book.downloadTo; i++) {
        // Se il numero della pagina è segnato come "defaults"
        // significa che si è arrivati in fondo.  E comunque
        // non è una pagina scaricabile.
        if (book.pages[i].number === "defaults") {
            continue;
        }
        logger.debug(`Scarico pag. ${book.pages[i].number} di ${book.downloadTo}`);

        // Imposto URL e nomi dei singoli livelli della pagina
        let foreground_url;
        // let background_url;
        let foreground_filename;
        if (book.pages[i].isVector) {
            foreground_url = `https://www.edravet.it/fb/${book.isbn}/files/assets/common/page-vectorlayers/${pad(4, book.pages[i].number, '0')}.svg`;
            // background_url = `https://www.edravet.it/fb/${book.isbn}/files/assets/common/page-html5-substrates/page${pad(4, book.pages[i].number, '0')}_4.jpg`;
            foreground_filename = `${book.isbn}-${pad(4, book.pages[i].number, '0')}-fg.svg`;
        } else {
            foreground_url = `https://www.edravet.it/fb/${book.isbn}/files/assets/common/page-textlayers/page${pad(4, book.pages[i].number, '0')}_l1.png`;
            // background_url = `https://www.edravet.it/fb/${book.isbn}/files/assets/common/page-html5-substrates/page${pad(4, book.pages[i].number, '0')}_l.jpg`;
            foreground_filename = `${book.isbn}-${pad(4, book.pages[i].number, '0')}-fg.png`;
        }

        const background_url = `https://www.edravet.it/fb/${book.isbn}/files/assets/common/page-html5-substrates/page${pad(4, book.pages[i].number, '0')}_4.jpg`;
        const background_filename = `${book.isbn}-${pad(4, book.pages[i].number, '0')}-bg.jpg`;
        const foreground_path = `${tmpDir}/${foreground_filename}`;
        const background_path = `${tmpDir}/${background_filename}`;

        // A meno che non sia richiesto di evitare
        // i download, inizio a scaricare i livelli...
        if (program.dryRun === undefined) {
            // ...parto dallo sfondo...
            logger.debug(`Scarico lo sfondo: ${background_url}`);
            await fetch(background_url, options)
                .then(res => {
                    const dest = fs.createWriteStream(background_path);
                    res.body.pipe(dest);
                })
                .catch(error => {
                    logger.error(`Si è verificato un problema con il download dello sfondo da ${background_url}`);
                });
            // ...continuo con il testo cambiando
            // il metodo se è raster o vettoriale...
            if (book.pages[i].hasText) {
                logger.debug(`Scarico il testo:  ${foreground_url}`);
                if (book.pages[i].isVector) {
                    logger.debug('Il testo è vettoriale.');
                    await fetch(foreground_url, options)
                        .then(res => res.text())
                        .then(body => {
                            fs.writeFile(foreground_path, body, (err) => {
                                if (err) throw err;
                            });
                        })
                        .catch(error => {
                            logger.error(`Si è verificato un problema con il download del testo da ${foreground_url}`);
                        });
                } else {
                    logger.debug('Il testo è raster.');
                    await fetch(foreground_url, options)
                        .then(res => {
                            const dest = fs.createWriteStream(foreground_path);
                            res.body.pipe(dest);
                        })
                        .catch(error => {
                            logger.error(`Si è verificato un problema con il download del testo da ${foreground_url}`);
                        });
                }
            } else {
                // ...o salto il download dello sfondo se questo non esiste.
                logger.debug(`Pag. ${book.pages[i].number} è priva di testo`);
            }
        }

        // A meno che non sia stato richiesto il semplice download
        // o di non scaricare nulla, procedo con la compilazione
        if (
            !(
                (program.download !== undefined) ||
                (program.dryRun !== undefined)
            )
        ) {
            const background = background_path;
            const foreground = book.pages[i].hasText ? foreground_path : false;
            await merge(book.pages[i].number, foreground, background);
        }

        // Salto la pausa se è ciò che è stato richiesto,
        // una pagina sì e una no,
        // o se sono arrivato all'ultima pagina
        if (
            (program.fullSpeed === undefined) &&
            !(i % 2) &&
            (i !== (book.downloadTo - 1))
        ) {
            await pause(false);
        }

        // Se non è impostata la verbosità ma viene
        // usata la barra, avanzo di uno.
        if (program.verbose === undefined) {
            downloadBar.tick();
        }
    }
}

async function merge(pageNumber, foreground_filename, background_filename) {
    logger.debug(`Compilo la pagina n. ${pageNumber}`);

    // Inizializzo Puppeteer per la compilazione della
    // pagina e imposto la cartella in cui salvare il file
    const Puppeteer = require('puppeteer');
    const filePath = `${tmpDir}/${book.isbn}_${pad(4, pageNumber, '0')}.pdf`;

    // Controllo di avere tutti i file necessari
    logger.debug('Cerco i file')
    do {
        logger.debug(`Attendo lo sfondo della pagina n. ${pageNumber}...`);

        await pause(500);
        var background_exists = fs.existsSync(background_filename);
        do {
            var foreground_exists = false;
            if (foreground_filename === false) {
                logger.debug(`La pagina n. ${pageNumber} non ha testo.`);
                break;
            } else {
                logger.debug(`Attendo il testo della pagina n. ${pageNumber}...`);
                await pause(500);
                foreground_exists = fs.existsSync(foreground_filename);
            }
        } while (!foreground_exists); 
    } while (!background_exists);
    logger.debug(`Ho tutto per la pagina n. ${pageNumber}`);
    logger.debug(`File per lo sfondo: ${background_filename}`);
    logger.debug(`File per il testo:  ${foreground_filename}`);

    let background_content;
    let foreground_content;
    let template;
    let pageSize = await checkAspectRatio(background_filename);

    // Differenzio i template in base al contenuto del
    // livello superiore (se il testo è raster o vettoriale).
    if (book.pages[pageNumber - 1].isVector) {
        try {
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
            template = `<html><body style="margin:0"><div style="background-image: url(data:image/jpg;base64,${background_content});background-size: 100%;width: ${pageSize.width}mm;height: ${pageSize.height}mm;"><img src="data:image/svg+xml;base64,${foreground_content}" style="width:100%"></div></body></html>`;
        } catch (err) {
            logger.error(err);
        }
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
        template = `<html><body style="margin:0"><div style="background-image: url(data:image/jpg;base64,${background_content});background-size: 100%;width: ${pageSize.width}mm;height: ${pageSize.height}mm;"><img src="data:image/png;base64,${foreground_content}" style="width:100%"></div></body></html>`;
    }

    // Creo il browser e imposto la pagina per il salvataggio in PDF
    let browser;
    browser = await Puppeteer.launch(); //{executablePath: '/opt/homebrew/bin/chromium'});
    const page = await browser.newPage();
    await page.setContent(template);
    logger.debug('Salvo la pagina come PDF');
    let contentScale = 1;
    if (book.pages[pageNumber - 1].contentScale) {
        contentScale = book.pages[pageNumber - 1].contentScale;
    }
    await page.pdf({
        path: filePath,
        width: `${pageSize.width}mm`,
        height: `${pageSize.height}mm`,
        scale: contentScale,
        pageRanges: '1',
        printBackground: true
    });

    // Se non è richiesta la compilazione delle singole
    // pagine soltanto, aggiungo la pagina al PDF
    if (program.single === undefined) {
        logger.debug('Aggiungo la pagina al PDF finale')
        merger.add(filePath);
    }

    await browser.close();
}

function printInfo(book) {
    console.log(`Title: ${book.title}`);
    console.log(`ISBN: ${book.isbn}`);
    console.log(`Number of pages: ${book.pages.length}`);
    console.log(`Page size in pixels: ${book.size.width}×${book.size.height}`);
    console.log(`Estimated page size in millimetres: ${book.realSize.width}×${book.realSize.height}`)
}

function pause(length) {
    let ms;
    if (length === false) {
        ms = Math.random() * (8000 - 2000) + 2000;
        logger.debug(`Waiting for ${Math.round(ms / 1000)} seconds`);
    } else {
        ms = length;
    }
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function checkAspectRatio(filename) {
    const probe = require('probe-image-size');
    let result = await probe(fs.createReadStream(filename));
    // Ottengo le proporzioni attuali
    let aspectRatio = result.height / result.width;

    // Se il rapporto è superiore alla radice di 2, allora
    // la pagina è più alta che larga rispetto alla carta
    // di formato A (A4, A5, ecc.).  Se è inferiore, allora
    // la pagina è più larga che alta.  Imposto uno dei due
    // valori come base e calcolo l'altro in rapporto.
    let realSize = {
        width: 0,
        height: 0
    };
    let a4paper = {
        width: 210,
        height: 297
    };

    if (aspectRatio > Math.SQRT2) {
        realSize.width = a4paper.width;
        realSize.height = Math.ceil(a4paper.width * aspectRatio);
    } else {
        realSize.height = a4paper.height;
        realSize.width = Math.ceil(a4paper.height / aspectRatio);
    }

    return realSize;
}