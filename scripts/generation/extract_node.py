"""Extract only Node and its notices from a verified official archive."""
import argparse
from pathlib import Path
import shutil
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument("archive", type=Path)
parser.add_argument("prefix")
parser.add_argument("destination", type=Path)
args = parser.parse_args()
args.destination.mkdir(parents=True, exist_ok=True)
with tarfile.open(args.archive) as archive:
    for relative, name in [("bin/node", "node"), ("LICENSE", "LICENSE")]:
        member = archive.getmember(args.prefix + "/" + relative)
        if not member.isfile():
            raise RuntimeError("Unexpected archive entry")
        with archive.extractfile(member) as source, (args.destination / name).open("wb") as output:
            shutil.copyfileobj(source, output)
        (args.destination / name).chmod(0o755 if name == "node" else 0o644)
