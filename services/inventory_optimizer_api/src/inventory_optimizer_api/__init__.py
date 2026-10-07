"""QuantMeridian's narrow InventoryBallast service boundary."""

from .engine_source import activate_engine_path

# Must run before any submodule imports the engine, so a configured local checkout wins.
activate_engine_path()

__version__ = "0.1.0"
