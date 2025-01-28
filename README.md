# lutra

This is a VS Code extension for the Lutra UI library for Svelte 5. It provides CSS variable completions for Lutra UI and other global CSS variables found in the project. This extension is currently in development and may have some issues.

## Requirements

This extension requires a workspace with the Lutra UI library installed.

## Extension Settings

- `lutra.enableLogging`: Enable detailed logging in the output panel for debugging.
  Default: `false`
- `lutra.cssGlobPatterns`: Glob patterns to search for CSS files containing variables.
  Default: `["**/*.css", "**/node_modules/lutra/**/*.css"]`
- `lutra.svelteGlobPatterns`: Glob patterns to search for Svelte components containing CSS properties.
  Default: `["**/node_modules/lutra/**/*.svelte"]`
- `lutra.excludePatterns`: Glob patterns to exclude from the search.
  Default: `["**/node_modules/**/node_modules/**", "**/dist/**", "**/.svelte-kit/**", "**/build/**"]`

## License

MIT
