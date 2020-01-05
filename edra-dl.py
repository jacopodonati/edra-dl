import argparse
import json
import logging
import os
# import pillow
from tqdm import tqdm
from is_isbn.is_isbn import is_isbn

book = {}

def get_info(isbn):
    global book
    book['sources'] = {}
    book['sources']['toc'] = f'b{isbn}.js' # f'https://www.edravet.it/fb/{isbn}/files/assets/html/workspace.js'
    book['sources']['pages'] = f'p{isbn}.js' # f'https://www.edravet.it/fb/{isbn}/files/assets/common/pager.js'

    logging.info(f'Loading JSON TOC from {book["sources"]["toc"]}')
    with open(book['sources']['toc']) as f:
        d = json.load(f)
        book['title'] = d['title']

    logging.info(f'Loading JSON pages from {book["sources"]["pages"]}')
    with open(book['sources']['pages']) as f:
        d = json.load(f)
        pages = d['pages']

        del pages['defaults']
        del pages['structure']

        book['pages'] = []
        for page in pages:
            book['pages'].append(page)
        
        book['length'] = len(book['pages'])

    logging.info(f'ISBN: {book["ISBN"]}')
    logging.info(f'Title: {book["title"]}')
    logging.info(f'Number of pages: {book["length"]}')
    return

def get_files():
    return

def blend_files():
    return

def setup_args():
    parser = argparse.ArgumentParser(description='Download libri EDRA')
    parser.add_argument('-t', '--test-run', action='store_true')
    parser.add_argument('-f', '--full-speed', action='store_true')
    parser.add_argument('-v', '--verbose', action='count', default=0)
    parser.add_argument('ISBN')
    return parser.parse_args()

def setup_logging(args):
    level = logging.WARNING
    if args.verbose > 0:
        level = logging.DEBUG
        if args.verbose > 1:
            level = logging.INFO
    logging.basicConfig(format='%(levelname)s: %(message)s', level=level)
    return

def main():
    global book
    args = setup_args()
    setup_logging(args)
    logging.info(f'Checking ISBN: {args.ISBN}')
    if (not is_isbn(args.ISBN)):
        print(f'{args.ISBN} is not a valid ISBN code. I think I\'ll die.')
        quit()
    logging.info(f'{args.ISBN} is a valid ISBN')
    book['ISBN'] = args.ISBN
    get_info(book['ISBN'])
    return


if __name__ == '__main__':
    main()
