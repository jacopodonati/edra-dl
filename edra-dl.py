import argparse
from is_isbn.is_isbn import is_isbn
import json
import logging
from pathlib import Path
# from PIL import Image
import shutil
from time import sleep
from random import randrange
import requests
# from tqdm import tqdm

# 9788821447167

book = {}
args = None

def get_info():
    global book
    book['sources'] = {}
    book['sources']['toc'] = f'https://www.edravet.it/fb/{book["ISBN"]}/files/assets/html/workspace.js' # f'b{book["ISBN"]}.js' 
    book['sources']['pages'] =  f'https://www.edravet.it/fb/{book["ISBN"]}/files/assets/common/pager.js' # f'p{book["ISBN"]}.js'
    headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/50.0.2661.75 Safari/537.36' }

    logging.info(f'Loading JSON TOC from {book["sources"]["toc"]}')
    with requests.get(book["sources"]["toc"], headers=headers) as r:
        if r.status_code == 200:
            data = r.json()
            book['title'] = data['title']
            
    logging.info(f'Loading JSON pages from {book["sources"]["pages"]}')
    with requests.get(book["sources"]["pages"], headers=headers) as r:
        data = r.json()
        pages = data['pages']

        del pages['defaults']
        del pages['structure']

        book['pages'] = []
        for page_number in pages:
            page = {}
            page["number"] = int(page_number)
            if 'textLayer' in pages[page_number]:
                page['has_text'] = True
            else:
                page['has_text'] = False
            book['pages'].append(page)
        
        book['length'] = len(book['pages'])

    logging.info(f'ISBN: {book["ISBN"]}')
    logging.info(f'Title: {book["title"]}')
    logging.info(f'Number of pages: {book["length"]}')
    return

def get_files(full_speed=False, test_run=False):
    global book
    tmp_dir = 'tmp'
    headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/50.0.2661.75 Safari/537.36' }

    logging.info('Creating folder: {tmp_dir}')
    Path(tmp_dir).mkdir(parents=True, exist_ok=True)

    logging.info('Downloading pages')

    for page in book['pages']: # zip(range(10), book['pages']):
        foreground_url = f'https://www.edravet.it/fb/{book["ISBN"]}/files/assets/common/page-vectorlayers/{str(page["number"]).zfill(4)}.svg'
        background_url = f'https://www.edravet.it/fb/{book["ISBN"]}/files/assets/common/page-html5-substrates/page{str(page["number"]).zfill(4)}_4.jpg'
        foreground_filename = f'{book["ISBN"]}-{str(page["number"]).zfill(4)}-foreground.svg'
        background_filename = f'{book["ISBN"]}-{str(page["number"]).zfill(4)}-background.jpg'
        foreground_path = f'{tmp_dir}/{foreground_filename}'
        background_path = f'{tmp_dir}/{background_filename}'

        logging.info(f'Getting background of page n. {page["number"]}')
        if not test_run:
            r = requests.get(background_url, headers=headers, stream=True)
            if r.status_code == 200:
                logging.info(f'Writing {background_path}.')
                with open(background_path, 'wb') as f:
                    r.raw.decode_content = True
                    shutil.copyfileobj(r.raw, f)
                    f.close()

        if page['has_text']:
            logging.info(f'Getting foreground of page n. {page["number"]}')
            if not test_run:
                r = requests.get(foreground_url, headers=headers)
                if r.status_code == 200:
                    logging.info(f'Writing {foreground_path}.')
                    with open(foreground_path, 'w', encoding="utf-8") as f:
                        f.write(r.text)
                        f.close()
        else:
            logging.info(f'No foreground for page n. {page["number"]}')

        # logging.info(f'Rendering PDF for page n. {page["number"]}')
        # render_pdf_page()

        if not full_speed:
            pause = randrange(2,8)
            logging.info(f'Waiting {pause} seconds')
            sleep(pause)
    return

def render_pdf():
    return

def render_pdf_page():
    return

def setup_args():
    parser = argparse.ArgumentParser(description='Download libri EDRA')
    parser.add_argument('-t', '--test-run', action='store_true')
    parser.add_argument('-f', '--full-speed', action='store_true')
    parser.add_argument('-v', '--verbose', action='count', default=0)
    parser.add_argument('ISBN')
    return parser.parse_args()

def setup_logging():
    global args
    level = logging.WARNING
    if args.verbose > 0:
        level = logging.DEBUG
        if args.verbose > 1:
            level = logging.INFO
    logging.basicConfig(format='%(levelname)s: %(message)s', level=level)
    return

def main():
    global book
    global args
    args = setup_args()
    setup_logging()
    logging.info(f'Checking ISBN: {args.ISBN}')
    if (not is_isbn(args.ISBN)):
        print(f'{args.ISBN} is not a valid ISBN code. I think I\'ll die.')
        quit()
    logging.info(f'{args.ISBN} is a valid ISBN')
    book['ISBN'] = args.ISBN
    get_info()
    get_files(full_speed=args.full_speed, test_run=args.test_run )
    # render_pdf()
    return

if __name__ == '__main__':
    main()
