import fs from 'fs/promises';
import path from 'path';
import chokidar from 'chokidar';
import StyleDictionary from 'style-dictionary';
import { fileHeader } from './fileHeader.js';
import { glob } from 'glob';

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

async function readJsonFilesFromDir(dir) {
    const files = (await fs.readdir(dir)).filter(file => file.endsWith('.json'));
    return files.reduce(async (accPromise, file) => {
            const acc = await accPromise;
            const name = path.basename(file, '.json');
            const filePath = path.join(dir, file);
            acc[name] = JSON.parse(await fs.readFile(filePath, 'utf8'));
            return acc;
        }, Promise.resolve({}));
}

async function loadTokens() {
    const tokensDir = './tokens';

    // --- 1. Build Base Primitives ---
    console.log('\nBuilding base primitive tokens...');
    const aliasDir = path.join(tokensDir, 'alias');
    const primitivesDir = path.join(tokensDir, 'primitives');

    const aliasFilesPaths = (await fs.readdir(aliasDir)).filter(file => file.endsWith('.json')).map(file => path.join(aliasDir, file));
    const primitiveFilesPaths = (await fs.readdir(primitivesDir)).filter(file => file.endsWith('.json')).map(file => path.join(primitivesDir, file));
    const allBaseFiles = [...aliasFilesPaths, ...primitiveFilesPaths];

    const aliasTokens = await aliasFilesPaths.reduce(async (accPromise, file) => {
        const acc = await accPromise;
        return mergeDeep(acc, JSON.parse(await fs.readFile(file, 'utf8')));
    }, Promise.resolve({}));

    const primitiveTokens = await primitiveFilesPaths.reduce(async (accPromise, file) => {
        const acc = await accPromise;
        return mergeDeep(acc, JSON.parse(await fs.readFile(file, 'utf8')));
    }, Promise.resolve({}));


    const brands = await readJsonFilesFromDir(path.join(tokensDir, 'alias', 'brands'));
    const modes = await readJsonFilesFromDir(path.join(tokensDir, 'semantic', 'modes'));
    const shapes = await readJsonFilesFromDir(path.join(tokensDir, 'semantic', 'shapes'));
    const densities = await readJsonFilesFromDir(path.join(tokensDir, 'semantic', 'densities'));

    const componentsDir = path.join(tokensDir, 'components');
    const componentFiles = (await fs.readdir(componentsDir)).filter(file => file.endsWith('.json')); // This is correct
    const componentTokens = await componentFiles.reduce(async (accPromise, file) => {
        const acc = await accPromise;
        const componentPath = path.join(componentsDir, file);
        const componentTokenData = JSON.parse(await fs.readFile(componentPath, 'utf8'));
        console.log(`🧬 Merging component tokens from ${file}`);
        return mergeDeep(acc, componentTokenData);
    }, Promise.resolve({}));

    return { primitiveTokens, aliasTokens, allBaseFiles, primitiveFilesPaths, brands, modes, shapes, densities, componentTokens };
}

async function buildThemes(tokenData) {
    const { primitiveTokens, aliasTokens, brands, modes, shapes, densities, componentTokens, allBaseFiles } = tokenData;
    const buildDir = './build';
    const themesIndex = {};

    // --- 2. Merge and Build Themes ---
    for (const [brandName, brandTokens] of Object.entries(brands)) {
        for (const [modeName, modeTokens] of Object.entries(modes)) {
            for (const [shapeName, shapeTokens] of Object.entries(shapes)) {
                for (const [densityName, densityTokens] of Object.entries(densities)) {

                    let merged = mergeDeep(primitiveTokens, aliasTokens);
                    merged = mergeDeep(merged, brandTokens);
                    merged = mergeDeep(merged, modeTokens);
                    merged = mergeDeep(merged, shapeTokens);
                    merged = mergeDeep(merged, densityTokens);
                    merged = mergeDeep(merged, componentTokens);

                    const themeName = `${brandName}-${modeName}-${shapeName}-${densityName}`;
                    const fileName = `token/${themeName}.json`;
                    const filePath = `${buildDir}/${fileName}`;
                    const fileDir = path.dirname(filePath);
                    await fs.mkdir(fileDir, { recursive: true });

                    // Recursively add metadata to tokens.
                    // We traverse the source objects to decide if a token is primitive or not.
                    const addMetadata = (targetObj, sourceObj, isPrimitive) => {
                        for (const key in sourceObj) {
                            if (sourceObj.hasOwnProperty(key) && targetObj.hasOwnProperty(key)) {
                                if (sourceObj[key].hasOwnProperty('value')) { // This is a token
                                    targetObj[key].attributes = targetObj[key].attributes || {};
                                    targetObj[key].attributes.isPrimitive = isPrimitive;
                                } else if (typeof sourceObj[key] === 'object' && sourceObj[key] !== null) { // This is a category
                                    addMetadata(targetObj[key], sourceObj[key], isPrimitive);
                                }
                            }
                        }
                    };

                    const finalTokens = JSON.parse(JSON.stringify(merged)); // Deep copy
                    addMetadata(finalTokens, primitiveTokens, true);
                    [aliasTokens, brandTokens, modeTokens, shapeTokens, densityTokens, componentTokens].forEach(tokenSet => {
                        addMetadata(finalTokens, tokenSet, false);
                    });

                    await fs.writeFile(filePath, JSON.stringify(finalTokens, null, 2));
                    themesIndex[themeName] = `./${fileName}`;

                    console.log(`✅ Merged ${fileName}`);
                }
            }
        }
    }

    await fs.writeFile(`${buildDir}/themes.json`, JSON.stringify(themesIndex, null, 2));
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
                        outputReferences: false,
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
                        outputReferences: false,
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
                        outputReferences: false,
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
                            outputReferences: true,
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
                            outputReferences: true,
                        },
                        // Exclude primitive tokens to avoid duplication with the base file
                        filter: (token) => !token.attributes.isPrimitive,
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
                            outputReferences: true,
                        },
                        // Exclude primitive tokens to avoid duplication with the base file
                        filter: (token) => !token.attributes.isPrimitive,
                    }]
                }
            }
        });

        SD.buildAllPlatforms();
        console.log(`✅ Built Web/Android/iOS for ${themeName}`);
    });
}

async function buildAll() {
    const buildDir = './build';
    console.log('\n🔄 Rebuilding tokens for ALL brands & platforms...');
    
    await fs.mkdir(buildDir, { recursive: true }).catch(() => {});
    const tokenData = await loadTokens();
    const themesIndex = await buildThemes(tokenData);

    buildBase(tokenData.primitiveFilesPaths);
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

const handleFileChange = debounce(async (filePath) => {
    console.log(`\n📂 Detected change in: ${filePath}`);
    try {
        await buildAll();
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