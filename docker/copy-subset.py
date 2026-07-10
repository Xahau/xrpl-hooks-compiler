#!/usr/bin/python3

import json
import os
import shutil
import sys

rule_list = None

def init_patterns(in_list, out_heads, out_set):
    for pattern in in_list:
        if not pattern:
            raise Exception("empty pattern")

        if pattern[-1] == '*':
            pattern_head = pattern[:-1]
            if pattern_head:
                out_heads.append(pattern_head)
            else:
                raise Exception("star pattern without name")
        else:
            out_set.add(pattern)


def is_included_in(name, conf_heads, conf_set):
    for head in conf_heads:
        if name.startswith(head):
            return True

    return name in conf_set


def excluder(directory, contents):
    excluded = []

    for rule in rule_list:
        tail = rule['tail']
        if directory.endswith(tail):
            white_list = rule.get('whitelist')
            if white_list:
                if 'blacklist' in rule:
                    raise Exception("whitelist & blacklist cannot be combined")

                white_heads = []
                white_set = set()
                init_patterns(white_list, white_heads, white_set)
                for name in contents:
                    if not is_included_in(name, white_heads, white_set):
                        excluded.append(name)
            else:
                black_list = rule.get('blacklist')
                if not black_list:
                    raise Exception("rule has neither whitelist nor blacklist")

                black_heads = []
                black_set = set()
                init_patterns(black_list, black_heads, black_set)
                for name in contents:
                    if is_included_in(name, black_heads, black_set):
                        excluded.append(name)

    return excluded


def main():
    global rule_list

    if len(sys.argv) != 4:
        raise Exception("usage: %s config source target" % sys.argv[0])

    with open(sys.argv[1], "r") as f:
        rule_list = json.load(f)

    if os.path.exists(sys.argv[3]):
        shutil.rmtree(sys.argv[3])

    shutil.copytree(sys.argv[2], sys.argv[3], ignore=excluder)


if __name__ == "__main__":
    main()
