import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';
import StyleDictionary from 'style-dictionary';
import { fileHeader } from './fileHeader.js';

StyleDictionary.registerTransform({
    name: 'ts/size/lineheight',
    type: 'value',
    filter: (token) => token.type === 'lineHeight',
    transform: (token) => {
        if (typeof token.value === 'string' && token.value.endsWith('%')) {
            return parseFloat(token.value) / 100;
        }
        return token.value;
    }
});

// Register the custom transform group
StyleDictionary.registerTransformGroup({
    name: 'custom/css',
    transforms: ['attribute/cti', 'name/kebab', 'color/css', 'size/pxToRem', 'ts/size/lineheight']
});

StyleDictionary.registerTransformGroup({
    name: 'custom/android',
    transforms: ['size/pxToRem'].concat(StyleDictionary.hooks.transformGroups['android'], ['ts/size/lineheight'])
});

StyleDictionary.registerTransformGroup({
    name: 'custom/ios-swift',
    transforms: ['size/pxToRem'].concat(StyleDictionary.hooks.transformGroups['ios-swift'], ['ts/size/lineheight'])
});

function mergeDeep(target, source) {
    const output = { ...target, ...source };
    if (typeof target === 'object' && target !== null && typeof source === 'object' && source !== null) {
        for (const key of Object.keys(source)) {
            if (typeof source[key] === 'object' && source[key] !== null && key in target && typeof target[key] === 'object' && target[key] !== null) {
                output[key] = mergeDeep(target[key], source[key]);
            }
        }
    }
    return output;
}

function readJsonFilesFromDir(dir) {
    return fs.readdirSync(dir)
        .filter(file => file.endsWith('.json'))
        .reduce((acc, file) => {
            const name = path.basename(file, '.json');
            const filePath = path.join(dir, file);
            acc[name] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return acc;
        }, {});
}

function loadTokens() {
    const tokensDir = './tokens';

    // --- 1. Build Base Primitives ---
    console.log('\nBuilding base primitive tokens...');
    const primitivesDir = path.join(tokensDir, 'primitives');
    const primitiveFiles = fs.readdirSync(primitivesDir).filter(file => file.endsWith('.json')).map(file => path.join(primitivesDir, file));

    const primitiveTokens = primitiveFiles.reduce((acc, file) => {
        return mergeDeep(acc, JSON.parse(fs.readFileSync(file, 'utf8')));
    }, {});

    const brands = readJsonFilesFromDir(path.join(tokensDir, 'brands'));
    const modes = readJsonFilesFromDir(path.join(tokensDir, 'modes'));
    const shapes = readJsonFilesFromDir(path.join(tokensDir, 'shapes'));
    const densities = readJsonFilesFromDir(path.join(tokensDir, 'densities'));

    const componentsDir = path.join(tokensDir, 'components');
    const componentFiles = fs.readdirSync(componentsDir).filter(file => file.endsWith('.json'));
    const componentTokens = componentFiles.reduce((acc, file) => {
        const componentPath = path.join(componentsDir, file);
        const componentTokenData = JSON.parse(fs.readFileSync(componentPath, 'utf8'));
        console.log(`🧬 Merging component tokens from ${file}`);
        return mergeDeep(acc, componentTokenData);
    }, {});

    return { primitiveTokens, primitiveFiles, brands, modes, shapes, densities, componentTokens };
}

function buildThemes(tokenData) {
    const { primitiveTokens, brands, modes, shapes, densities, componentTokens } = tokenData;
    const buildDir = './build';
    const themesIndex = {};

    // --- 2. Merge and Build Themes ---
    for (const [brandName, brandTokens] of Object.entries(brands)) {
        for (const [modeName, modeTokens] of Object.entries(modes)) {
            for (const [shapeName, shapeTokens] of Object.entries(shapes)) {
                for (const [densityName, densityTokens] of Object.entries(densities)) {

                    let merged = mergeDeep(primitiveTokens, brandTokens);
                    merged = mergeDeep(merged, modeTokens);
                    merged = mergeDeep(merged, shapeTokens);
                    merged = mergeDeep(merged, densityTokens);
                    merged = mergeDeep(merged, componentTokens);

                    // Recursively add metadata to tokens for filtering later
                    const addMetadata = (obj, isPrimitive) => {
                        for (const key in obj) {
                            if (obj.hasOwnProperty(key)) {
                                if (obj[key].hasOwnProperty('value')) { // This is a token
                                    obj[key].attributes = obj[key].attributes || {};
                                    obj[key].attributes.isPrimitive = isPrimitive;
                                } else if (typeof obj[key] === 'object' && obj[key] !== null) { // This is a category
                                    addMetadata(obj[key], isPrimitive);
                                }
                            }
                        }
                    };

                    const themeName = `${brandName}-${modeName}-${shapeName}-${densityName}`;
                    const fileName = `token/${themeName}.json`;
                    const filePath = `${buildDir}/${fileName}`;
                    const fileDir = path.dirname(filePath);

                    if (!fs.existsSync(fileDir)) {
                        fs.mkdirSync(fileDir, { recursive: true });
                    }

                    // Before writing, we need to flag the tokens.
                    // We create a deep copy of the merged tokens to modify.
                    const finalTokens = JSON.parse(JSON.stringify(merged));
                    addMetadata(finalTokens, true); // Assume all are primitive initially
                    // Then, override the flag for non-primitive tokens
                    [brandTokens, modeTokens, shapeTokens, densityTokens, componentTokens].forEach(tokenSet => addMetadata(finalTokens, false));

                    fs.writeFileSync(filePath, JSON.stringify(finalTokens, null, 2));
                    themesIndex[themeName] = `./${fileName}`;

                    console.log(`✅ Merged ${fileName}`);
                }
            }
        }
    }

    fs.writeFileSync(`${buildDir}/themes.json`, JSON.stringify(themesIndex, null, 2));
    console.log(`✅ Updated themes.json`);
    return themesIndex;
}

function buildBase(primitiveFiles) {
    const buildDir = './build';
    const baseBuildPath = `${buildDir}/base/`;
    const SDBase = new StyleDictionary({
        source: primitiveFiles,
        platforms: {
            css: {
                transformGroup: 'custom/css',
                buildPath: baseBuildPath,
                files: [{
                    destination: 'variables.css',
                    format: 'css/variables',
                    options: {
                        fileHeader: () => fileHeader(),
                    },
                }]
            },
            android: {
                transformGroup: 'custom/android',
                buildPath: baseBuildPath,
                files: [{
                    destination: 'tokens.xml',
                    format: 'android/resources',
                    options: {
                        fileHeader: () => fileHeader(),
                    },
                }]
            },
            ios: {
                transformGroup: 'custom/ios-swift',
                buildPath: baseBuildPath,
                files: [{
                    destination: 'StyleDictionary.swift',
                    format: 'ios-swift/class.swift',
                    options: {
                        fileHeader: () => fileHeader(),
                    },
                }]
            }
        }
    });
    SDBase.buildAllPlatforms();
    console.log(`✅ Built base primitives for Web/Android/iOS`);
}

function buildThemePlatforms(themesIndex) {
    const buildDir = './build';
    Object.entries(themesIndex).forEach(([themeName, filePath]) => {
        const [brand, ...rest] = themeName.split('-');
        const subTheme = rest.join('-');
        const newBuildPath = `${buildDir}/${brand}/${subTheme}/`;

        const SD = new StyleDictionary({
            source: [`${buildDir}/${filePath.replace('./', '')}`],
            platforms: {
                css: {
                    transformGroup: 'custom/css',
                    buildPath: newBuildPath,
                    files: [{
                        destination: 'variables.css',
                        format: 'css/variables',
                        options: {
                            fileHeader: () => fileHeader(),
                        },
                        // Exclude primitive tokens to avoid duplication with the base file
                        filter: (token) => !token.attributes.isPrimitive,
                    }]
                },
                android: {
                    transformGroup: 'custom/android',
                    buildPath: newBuildPath,
                    files: [{
                        destination: 'tokens.xml',
                        format: 'android/resources',
                        options: {
                            fileHeader: () => fileHeader(),
                        },
                    }]
                },
                ios: {
                    transformGroup: 'custom/ios-swift',
                    buildPath: newBuildPath,
                    files: [{
                        destination: 'StyleDictionary.swift',
                        format: 'ios-swift/class.swift',
                        className: 'StyleDictionary',
                        options: {
                            fileHeader: () => fileHeader(),
                        },
                    }]
                }
            }
        });

        SD.buildAllPlatforms();
        console.log(`✅ Built Web/Android/iOS for ${themeName}`);
    });
}

function buildAll() {
    const buildDir = './build';
    console.log('\n🔄 Rebuilding tokens for ALL brands & platforms...');

    if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });

    const tokenData = loadTokens();
    const themesIndex = buildThemes(tokenData);

    buildBase(tokenData.primitiveFiles);
    buildThemePlatforms(themesIndex);

    console.log(`🎉 Build complete!`);
}

function debounce(func, timeout = 300){
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { func.apply(this, args); }, timeout);
  };
}

const handleFileChange = debounce((filePath) => {
    console.log(`\n📂 Detected change in: ${filePath}`);
    try {
        buildAll();
    } catch (error) {
        console.error(`\n❌ Error during rebuild:`, error);
    }
});

// Initial build
buildAll();

const tokensDir = './tokens';

// Watch for changes
console.log('👀 Watching for token changes...');
chokidar
    .watch(`${tokensDir}/**/*.json`)
    .on('change', handleFileChange);