#!/usr/bin/python3

import glob
import json
import os
import re
import sys

includes = {}

# ignoring #include_next & other complications
include_rx = re.compile("^\s*#include\s+[\"<]([^\"<>]+)[\">]")

def is_include_top(directory, tail_list):
    for tail in tail_list:
        if directory.endswith(tail):
            return True

    return False


def scan_includes(top_dir, rel_path, dirs, files):
    for d in dirs:
        child_rel_path = os.path.join(rel_path, d)
        child_dir = os.path.join(top_dir, child_rel_path)
        child_dirs = []
        child_files = []
        mask = os.path.join(child_dir, "*")
        for path_name in glob.glob(mask):
            if os.path.isdir(path_name):
                child_dirs.append(os.path.basename(path_name))
            elif os.path.isfile(path_name):
                child_files.append(os.path.basename(path_name))
            else:
                raise Exception("%s is neither file nor directory" % path_name)

        scan_includes(top_dir, child_rel_path, child_dirs, child_files)

    for fname in files:
        incl_path = os.path.join(rel_path, fname)
        file_path = os.path.join(top_dir, incl_path)
        path_set = includes.setdefault(incl_path, set())
        path_set.add(file_path)


def check_include(fname):
    with open(fname, 'r') as f:
        for ln in f:
          m = include_rx.match(ln)
          if m:
              dep_incl = m.group(1)
              if dep_incl not in includes:
                  raise Exception("unknown include %s in %s" % (dep_incl, fname))


def main():
    if len(sys.argv) != 3:
        raise Exception("usage: %s config top" % sys.argv[0])

    tail_list = []
    with open(sys.argv[1], "r") as f:
        rule_list = json.load(f)
        for rule in rule_list:
            tail_list.append(rule['tail'])

    for parent, dirs, files in os.walk(sys.argv[2]):
        if is_include_top(parent, tail_list):
            scan_includes(parent, "", dirs, files)

    for incl_path, path_set in sorted(includes.items()):
        for file_path in sorted(path_set):
            check_include(file_path)

if __name__ == "__main__":
    main()
