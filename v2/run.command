#!/bin/zsh
set -e
cd -- "${0:A:h}"
if [[ ! -x .venv/bin/python ]]; then
  print 'Set up v2 first using the instructions in README.md.'
  exit 1
fi
exec ./.venv/bin/python -m panopto_archiver --include-playback --export --zip "$@"
