"""Single source of truth for the application version.

Bump ``__version__`` (SemVer: MAJOR.MINOR.PATCH) for every release, then tag
the commit ``vX.Y.Z`` and publish a matching GitHub Release. The auto-updater
compares this value against the latest GitHub Release tag.
"""

from __future__ import annotations

__version__ = "1.0.4"

# owner/repo used by the auto-updater to query the GitHub Releases API.
GITHUB_REPO = "DwennK/iPhoneLabelPrinter"
