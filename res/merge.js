// "use strict";

// const Puppeteer = require('puppeteer');
// const Fs = require('fs');

// (async () => {
//     var background = Fs.readFileSync('./bg.jpg', { encoding: 'base64' });
//     var foreground = Fs.readFileSync('./fg.svg', { encoding: 'base64' });
//     const template = `<html><body style="margin:0"><div style="background-image: url(data:image/jpg;base64,${background});background-size: 100%;"><img src="data:image/svg+xml;base64,${foreground}" style="width:100%"></div></body></html>`;

//     const browser = await Puppeteer.launch();
//     const page = await browser.newPage();
//     await page.setContent(template);
//     await page.pdf({ path: "./sample.pdf", format: "A4", printBackground: true });

//     await browser.close();
// })();

if (true) {
    let t = 'ehi';
}

console.log(t);