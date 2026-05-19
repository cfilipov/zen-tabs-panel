#!/bin/sh
set -e


EXTENSION_ID="zen-tabs-panel@c13v.com"
XPI_NAME="$EXTENSION_ID.xpi"
REPO="cfilipov/ergozen"
RELEASE_URL="https://github.com/$REPO/releases/latest/download/ergozen.xpi"
LEGACY_RELEASE_URL="https://github.com/$REPO/releases/latest/download/zen-tabs-panel.xpi"

# -- OS check ---------------------------------------------------------------

case "$(uname)" in
  Darwin)
    ZEN_DIR="$HOME/Library/Application Support/zen"
    ;;
  *)
    echo "Error: This installer only supports macOS."
    echo "For other platforms, see the manual install instructions:"
    echo "  https://github.com/$REPO#install"
    exit 1
    ;;
esac

if [ ! -d "$ZEN_DIR" ]; then
  echo "Error: Zen Browser profile directory not found at:"
  echo "  $ZEN_DIR"
  echo "Is Zen Browser installed?"
  exit 1
fi

PROFILES_INI="$ZEN_DIR/profiles.ini"
if [ ! -f "$PROFILES_INI" ]; then
  echo "Error: profiles.ini not found."
  exit 1
fi

# -- Parse profiles ----------------------------------------------------------

PROFILE_COUNT=0
INSTALL_DEFAULT=""

# First pass: find the Install section's Default (the actually active profile)
while IFS= read -r line || [ -n "$line" ]; do
  line=$(printf '%s' "$line" | tr -d '\r')
  case "$line" in
    \[Install*) IN_INSTALL=1 ;;
    \[*) IN_INSTALL="" ;;
  esac
  if [ "$IN_INSTALL" = "1" ]; then
    case "$line" in
      Default=*)
        INSTALL_DEFAULT="${line#Default=}"
        ;;
    esac
  fi
done < "$PROFILES_INI"

# Second pass: collect profiles
IN_PROFILE=""
CURRENT_NAME=""
CURRENT_PATH=""
CURRENT_RELATIVE=""

flush_profile() {
  if [ -n "$CURRENT_PATH" ]; then
    if [ "$CURRENT_RELATIVE" = "1" ]; then
      FULL_PATH="$ZEN_DIR/$CURRENT_PATH"
    else
      FULL_PATH="$CURRENT_PATH"
    fi
    if [ -d "$FULL_PATH" ]; then
      DISPLAY_NAME="${CURRENT_NAME:-$(basename "$CURRENT_PATH")}"
      eval "PROFILE_PATH_$PROFILE_COUNT=\"\$FULL_PATH\""
      eval "PROFILE_NAME_$PROFILE_COUNT=\"\$DISPLAY_NAME\""
      if [ "$CURRENT_PATH" = "$INSTALL_DEFAULT" ]; then
        DEFAULT_INDEX=$PROFILE_COUNT
      fi
      PROFILE_COUNT=$((PROFILE_COUNT + 1))
    fi
  fi
  CURRENT_NAME=""
  CURRENT_PATH=""
  CURRENT_RELATIVE=""
}

DEFAULT_INDEX=0

while IFS= read -r line || [ -n "$line" ]; do
  line=$(printf '%s' "$line" | tr -d '\r')
  case "$line" in
    \[Profile*) flush_profile; IN_PROFILE=1 ;;
    \[*) flush_profile; IN_PROFILE="" ;;
  esac
  if [ "$IN_PROFILE" = "1" ]; then
    case "$line" in
      Name=*) CURRENT_NAME="${line#Name=}" ;;
      Path=*) CURRENT_PATH="${line#Path=}" ;;
      IsRelative=*) CURRENT_RELATIVE="${line#IsRelative=}" ;;
    esac
  fi
done < "$PROFILES_INI"
flush_profile

if [ "$PROFILE_COUNT" = "0" ]; then
  echo "Error: No Zen profiles found."
  exit 1
fi

# -- Select profile ----------------------------------------------------------

if [ "$PROFILE_COUNT" = "1" ]; then
  eval "PROFILE_DIR=\"\$PROFILE_PATH_0\""
  eval "PROFILE_DISPLAY=\"\$PROFILE_NAME_0\""
  echo "Using profile: $PROFILE_DISPLAY"
else
  echo "Available Zen profiles:"
  I=0
  while [ "$I" -lt "$PROFILE_COUNT" ]; do
    eval "NAME=\"\$PROFILE_NAME_$I\""
    MARKER=""
    if [ "$I" = "$DEFAULT_INDEX" ]; then
      MARKER=" (default)"
    fi
    echo "  $I) $NAME$MARKER"
    I=$((I + 1))
  done

  printf "Select profile [%s]: " "$DEFAULT_INDEX"
  read -r SELECTION
  SELECTION="${SELECTION:-$DEFAULT_INDEX}"

  if [ "$SELECTION" -lt 0 ] 2>/dev/null || [ "$SELECTION" -ge "$PROFILE_COUNT" ] 2>/dev/null; then
    echo "Error: Invalid selection."
    exit 1
  fi

  eval "PROFILE_DIR=\"\$PROFILE_PATH_$SELECTION\""
  eval "PROFILE_DISPLAY=\"\$PROFILE_NAME_$SELECTION\""

  if [ -z "$PROFILE_DIR" ]; then
    echo "Error: Invalid selection."
    exit 1
  fi
  echo "Using profile: $PROFILE_DISPLAY"
fi

# -- Check if Zen is running -------------------------------------------------

if pgrep -x zen > /dev/null 2>&1; then
  echo ""
  echo "Warning: Zen Browser is currently running."
  echo "Changes will take effect after you restart Zen."
  echo ""
fi

# -- Check existing install ---------------------------------------------------

XPI_PATH="$PROFILE_DIR/extensions/$XPI_NAME"
CURRENT_VERSION=""

if [ -f "$XPI_PATH" ]; then
  CURRENT_VERSION=$(unzip -p "$XPI_PATH" manifest.json 2>/dev/null | grep '"version"' | head -1 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
fi

# -- Get latest version -------------------------------------------------------

LATEST_VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed 's/.*"v\([^"]*\)".*/\1/')

if [ -z "$LATEST_VERSION" ]; then
  echo "Error: Could not determine latest version."
  exit 1
fi

# -- Uninstall helper ---------------------------------------------------------

do_uninstall() {
  rm -f "$XPI_PATH"
  USER_JS="$PROFILE_DIR/user.js"
  if [ -f "$USER_JS" ]; then
    sed -i '' '/xpinstall\.signatures\.required/d' "$USER_JS"
    sed -i '' '/extensions\.experiments\.enabled/d' "$USER_JS"
    if [ ! -s "$USER_JS" ]; then
      rm -f "$USER_JS"
    fi
  fi
  echo ""
  echo "Uninstalled. Restart Zen Browser to complete removal."
  echo ""
  echo "Note: If you have other unsigned or experiment-API extensions,"
  echo "you may need to re-enable these settings in about:config:"
  echo "  xpinstall.signatures.required = false"
  echo "  extensions.experiments.enabled = true"
  exit 0
}

# -- Already installed: offer update or uninstall -----------------------------

if [ -n "$CURRENT_VERSION" ]; then
  echo ""
  echo "ErgoZen v$CURRENT_VERSION is currently installed."

  if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
    echo "You are already on the latest version (v$LATEST_VERSION)."
    echo ""
    printf "Would you like to uninstall? [y/N]: "
    read -r UNINSTALL
    case "$UNINSTALL" in
      [yY]|[yY][eE][sS]) do_uninstall ;;
      *) echo "No changes made."; exit 0 ;;
    esac
  else
    echo "A newer version is available: v$LATEST_VERSION"
    echo ""
    printf "1) Update  2) Uninstall  3) Cancel [1]: "
    read -r CHOICE
    CHOICE="${CHOICE:-1}"
    case "$CHOICE" in
      2) do_uninstall ;;
      3) echo "No changes made."; exit 0 ;;
      1) ;; # fall through to install
      *) echo "No changes made."; exit 0 ;;
    esac
  fi
fi

# -- Set about:config flags ---------------------------------------------------

USER_JS="$PROFILE_DIR/user.js"
touch "$USER_JS"

if ! grep -q 'xpinstall.signatures.required' "$USER_JS" 2>/dev/null; then
  echo 'user_pref("xpinstall.signatures.required", false);' >> "$USER_JS"
fi

if ! grep -q 'extensions.experiments.enabled' "$USER_JS" 2>/dev/null; then
  echo 'user_pref("extensions.experiments.enabled", true);' >> "$USER_JS"
fi

# -- Download and install XPI -------------------------------------------------

mkdir -p "$PROFILE_DIR/extensions"

echo "Downloading ErgoZen v$LATEST_VERSION..."
curl -fsSL -o "$XPI_PATH" "$RELEASE_URL" || curl -fsSL -o "$XPI_PATH" "$LEGACY_RELEASE_URL"

echo ""
if [ -n "$CURRENT_VERSION" ]; then
  echo "Updated ErgoZen from v$CURRENT_VERSION to v$LATEST_VERSION."
else
  echo "Installed ErgoZen v$LATEST_VERSION."
fi
echo "Restart Zen Browser to activate."
