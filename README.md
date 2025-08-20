# Design System Token Pipeline
Complete multi-brand, multi-theme, and semantic-aware token pipeline for Web, Android, and iOS.

## Structure layer
- Primitive & 
- Alias (Semantic base)
- Semantic
- Components

## 1. Install
```
npm install style-dictionary chokidar
```

## 2. Run
Build
```
node build-all-watch.js
```
Or run command

```
npm run watch
```

It auto-merges tokens, generates CSS/Android/iOS, and watches for changes.

## 3. Folder Structure
```
tokens/
  brands/
    brandA.json
    brandB.json
  modes/
    light.json
    dark.json
  densities/
    cozy.json
    compact.json
  components/
    sizing.json
    button.json
build/
build-all-watch.js
```

## 4. Output
- `variables.css` → Web
- `tokens.xml` → Android
- `StyleDictionary.swift` → iOS

## 5. Theme Naming
`brandA-light-cozy`, `brandB-dark-compact`, etc.

## 6. Hot Reload
Use symlinks to integrate directly into Android/iOS projects.
