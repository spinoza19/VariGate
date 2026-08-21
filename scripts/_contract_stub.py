"""Load contracts/varigate.py outside GenVM so its pure logic can be tested.

The contract does `from genlayer import *`, a module that only exists inside
the VM. We stand up just enough of it to exec the file and reach the
module-level helpers, then cut the contract class out: its storage annotations
and decorators have no meaning here and nothing under test lives inside it.
"""

from __future__ import annotations

import os
import sys
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_contract():
    """Exec contracts/varigate.py against a minimal fake `genlayer` module."""
    gl = types.SimpleNamespace()
    gl.Contract = type("Contract", (), {})
    gl.vm = types.SimpleNamespace(UserError=type("UserError", (Exception,), {}))
    gl.evm = types.SimpleNamespace(contract_interface=lambda c: c)
    gl.public = types.SimpleNamespace()

    stub = types.ModuleType("genlayer")
    stub.gl = gl
    stub.u8 = int
    stub.u32 = int
    stub.u64 = int
    stub.u256 = int
    stub.Address = str
    stub.DynArray = {}
    stub.TreeMap = {}
    stub.allow_storage = lambda c: c
    stub.__all__ = [
        "gl", "u8", "u32", "u64", "u256", "Address", "DynArray", "TreeMap", "allow_storage",
    ]
    sys.modules["genlayer"] = stub

    src = open(os.path.join(ROOT, "contracts", "varigate.py"), encoding="utf-8").read()
    # The class body annotates storage with types the stub cannot model, and the
    # decorators do not exist. Only the module-level helpers matter here, so cut
    # the contract class out and keep everything around it.
    start = src.index("class VariGate(gl.Contract):")
    end = src.index("# ------", src.index("Module-level helpers") - 400)
    trimmed = src[:start] + src[end:]

    ns: dict = {}
    exec(compile(trimmed, "varigate.py", "exec"), ns)
    return ns
