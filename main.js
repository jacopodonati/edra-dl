

"use strict";

// 9788821447167
// 6d7e16ec9967fedf470bc3615dd9e193

const Commander = require('commander');
const Program = new Commander.Command();
const Fetch = require('node-fetch');
const Fs = require('fs');
const Pad = require('pad');

/*******************************************************************************
 *  TODO: Aggiungere la possibilità di effettuare il download di un intervallo
 *        di pagine definito.
 ******************************************************************************/

Program
    .version('1.0.0')
    .requiredOption('-i, --isbn [ISBN code]', 'ISBN del libro')
    .option('-f, --full-speed', 'Don\'t wait between page downloads')
    .option('-t, --test-run', 'Avoid downloading pages');

    Program.parse(process.argv);

main(Program.isbn);

async function main(isbn) {
    console.log('Inizio download di:', isbn)
    var book = await getInfo(isbn);
    await getFiles(book);
    console.log('Fatto.');
}

async function getInfo(isbn) {
    var book = { isbn: isbn }
    
    book.sources = {
        toc: `https://www.edravet.it/fb/${book.isbn}/files/assets/html/workspace.js`,
        pages: `https://www.edravet.it/fb//${book.isbn}/files/assets/common/pager.js`,
        mock: '?uni=6d7e16ec9967fedf470bc3615dd9e193'
    }

    var options = {
        headers: {
            'Content-Type': 'application/javascript',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:73.0) Gecko/20100101 Firefox/73.0'
        }
    };
    
    console.log(`Scarico la TOC da ${book.sources.toc}`);
    var response =  await Fetch(book.sources.toc + book.sources.mock, options);
    var data = await response.json();
    book.title = data.title;

    console.log(`Scarico le pagine da ${book.sources.pages}`);
    var response =  await Fetch(book.sources.pages + book.sources.mock, options);
    var data = await response.json();
    var pages = data.pages;
    delete pages['defaults'];
    delete pages['structure'];
    book.pages = []
    for (var number in pages) {
        var hasText = false;
        if (pages[number].hasOwnProperty('textLayer')) {
            hasText = true;
        }
        var page = {
            'number': number,
            'hasText': hasText
        }
        book.pages.push(page);
    }
    return book;
}

async function getFiles(book) {
    var tmpRootDir = './tmp/';
    var tmpDir = tmpRootDir + book.isbn;
    var options = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:73.0) Gecko/20100101 Firefox/73.0'
        }
    };

    if (!Fs.existsSync(tmpRootDir)){
        console.log(`Creo la cartella ${tmpRootDir}`);
        Fs.mkdirSync(tmpRootDir);
    }
    if (!Fs.existsSync(tmpDir)){
        console.log(`Creo la cartella ${tmpDir}`);
        Fs.mkdirSync(tmpDir);
    }

    for (var i = 0; i < book.pages.length; i++) {
        var foreground_url = `https://www.edravet.it/fb/${book.isbn}/files/assets/common/page-vectorlayers/${Pad(4, book.pages[i].number, '0')}.svg`;
        var background_url = `https://www.edravet.it/fb/${book.isbn}/files/assets/common/page-html5-substrates/page${Pad(4, book.pages[i].number, '0')}_4.jpg`;
        var foreground_filename = `${book.isbn}-${Pad(4, book.pages[i].number, '0')}-foreground.svg`;
        var background_filename = `${book.isbn}-${Pad(4, book.pages[i].number, '0')}-background.jpg`;
        var foreground_path = `${tmpDir}/${foreground_filename}`;
        var background_path = `${tmpDir}/${background_filename}`;

        console.log('Scarico lo sfondo di pagina n. ', book.pages[i].number);
        if (!Program.testRun) {
            await Fetch(background_url + book.sources.mock, options)
                .then(res => {
                    const dest = Fs.createWriteStream(background_path);
                    res.body.pipe(dest);
                });
        }

        if (book.pages[i].hasText) {
            console.log('Scarico il testo di pagina n. ', book.pages[i].number);
            await Fetch(foreground_url + book.sources.mock, options)
                .then(res => res.text())
                .then(body => {
                    const dest = Fs.writeFile(foreground_path, body, (err) => {
                        if (err) throw err;
                      });
                })
                .catch(err => console.log(err));
        } else {
            console.log(`La pagina n. ${book.pages[i].number} è priva di testo`);
        }

        var background = background_path;
        var foreground = book.pages[i].hasText ? foreground_path : false;
        await merge(book.title, book.isbn, book.pages[i].number, background, foreground);

        if (!Program.fullSpeed) {
            await sleep();
        }
    }
}

function sleep() {
    var ms = Math.random() * (8000 - 2000) + 2000;
    console.log(`Pausa di ${Math.round(ms / 1000)} secondi`);
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }   

async function merge(title, isbn, pageNumber, text, background) {
    const Puppeteer = require('puppeteer');

    const tmpDir = './tmp/';
    const filePath = `${tmpDir}/${isbn}/${title}_${Pad(4, pageNumber, '0')}.pdf`;

    const background_content = Fs.readFileSync(background, { encoding: 'base64' });
    var foreground_content;
    if (text !== false) {
        foreground_content = Fs.readFileSync(text, { encoding: 'base64' });
    } else {
        foreground_content = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIHZpZXdCb3g9IjAgMCA1IDUiIGZpbGwtcnVsZT0iZXZlbm9kZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgc3Ryb2tlLW1pdGVybGltaXQ9IjIiLz4=';
    }
    // const template = `<html><body style="margin:0"><div style="background-image: url(data:image/jpg;base64,${background_content});background-size: 100%;"><img src="data:image/svg+xml;base64,${foreground_content}" style="width:100%"></div></body></html>`;

    // const browser = await Puppeteer.launch();
    // const page = await browser.newPage();
    // await page.setContent(template);
    // await page.pdf({ path: filePath, format: "A4", printBackground: true });

    // await browser.close();

    console.log(foreground_content);
};

