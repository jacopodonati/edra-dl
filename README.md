# edra-dl

This is a simple script to download PDFs from a specific website.I'm sharing it for academic purposes only, and it's not an endorsment to any kind of piracy.

Each PDF page is split in two layers, a raster background and a (usually) SVG file for the text. The trick is to download both, place it one on top of the other in a fake empty web page, and then print it with Chrome through `puppeteer`.
