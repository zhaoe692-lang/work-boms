#!/usr/bin/env python3
"""CLI shim — prefer: python3 validate_wbom.py …"""
from validate_wbom import main
import sys
if __name__ == "__main__":
    sys.exit(main())
