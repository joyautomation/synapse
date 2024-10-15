#!/bin/bash

# Check if VERSION parameter is provided
if [ $# -eq 0 ]; then
    echo "Error: VERSION parameter is required."
    echo "Usage: $0 <VERSION>"
    exit 1
fi

VERSION=$1

# Get the directory of the current script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Run the build script
deno run -A ${SCRIPT_DIR}/build_npm.ts "$VERSION"

# Move types.d.ts file
cp ${SCRIPT_DIR}/../npm/src/types.d.ts ${SCRIPT_DIR}/../npm/esm/types.d.ts

echo "Build completed and types.d.ts moved successfully."
