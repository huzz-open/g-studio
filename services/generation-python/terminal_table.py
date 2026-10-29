"""Align plain-text diagnostic columns using terminal display widths."""
import unicodedata


def display_width(text):
    return sum(0 if unicodedata.combining(char) else
               2 if unicodedata.east_asian_width(char) in ('W', 'F') else 1
               for char in text)


def format_table(headers, rows):
    cells = [[" ".join(str(value).split()) for value in row] for row in [headers, *rows]]
    widths = [max(display_width(row[column]) for row in cells) for column in range(len(headers))]

    def line(row):
        return ' | '.join(value + ' ' * (width - display_width(value))
                          for value, width in zip(row, widths)).rstrip()

    separator = '-+-'.join('-' * width for width in widths)
    return '\n'.join([line(cells[0]), separator, *(line(row) for row in cells[1:])])
