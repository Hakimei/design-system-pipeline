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
    const primitivesDir = path.join(tokensDir, 'primitives');
    const primitiveFiles = (await fs.readdir(primitivesDir)).filter(file => file.endsWith('.json')).map(file => path.join(primitivesDir, file));

    const primitiveTokens = await primitiveFiles.reduce(async (accPromise, file) => {
        const acc = await accPromise;
        return mergeDeep(acc, JSON.parse(await fs.readFile(file, 'utf8')));
    }, Promise.resolve({}));

    const brands = await readJsonFilesFromDir(path.join(tokensDir, 'brands'));
    const modes = await readJsonFilesFromDir(path.join(tokensDir, 'modes'));
    const shapes = await readJsonFilesFromDir(path.join(tokensDir, 'shapes'));
    const densities = await readJsonFilesFromDir(path.join(tokensDir, 'densities'));

    const componentsDir = path.join(tokensDir, 'components');
    const componentFiles = (await fs.readdir(componentsDir)).filter(file => file.endsWith('.json'));
    const componentTokens = await componentFiles.reduce(async (accPromise, file) => {
        const acc = await accPromise;
        const componentPath = path.join(componentsDir, file);
        const componentTokenData = JSON.parse(await fs.readFile(componentPath, 'utf8'));
        console.log(`🧬 Merging component tokens from ${file}`);
        return mergeDeep(acc, componentTokenData);
    }, Promise.resolve({}));

    return { primitiveTokens, primitiveFiles, brands, modes, shapes, densities, componentTokens };
}

async function buildThemes(tokenData) {
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
                    await fs.mkdir(fileDir, { recursive: true });

                    // Before writing, we need to flag the tokens. This part is synchronous.
                    // We create a deep copy of the merged tokens to modify.
                    const finalTokens = JSON.parse(JSON.stringify(merged));
                    addMetadata(finalTokens, true); // Assume all are primitive initially
                    // Then, override the flag for non-primitive tokens
                    [brandTokens, modeTokens, shapeTokens, densityTokens, componentTokens].forEach(tokenSet => addMetadata(finalTokens, false));

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

/**
 * This function adds comments to CSS files to group custom properties.
 */
async function addCommentsToCss() {
    console.log('\n✏️  Adding comments to generated CSS files...');

    // Mapping of custom property prefixes to their desired comment.
    const tokenGroupComments = {
        'color-': 'primitive color',
        'typography-': 'primitive typography',
        'colors-': 'semantic color',
        'border-radius-': 'semantic border radius',
        'spacing-': 'semantic spacing',
    };

    const cssFiles = await glob('build/**/variables.css');

    if (cssFiles.length === 0) {
        console.warn('⚠️ No "variables.css" files found to add comments to.');
        return;
    }

    for (const filePath of cssFiles) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n');
            const newLines = [];
            let inRootBlock = false;
            let lastMatchedPrefix = null;

            for (const line of lines) {
                if (line.trim() === ':root {') {
                    inRootBlock = true;
                    newLines.push(line);
                    continue;
                }

                if (line.trim() === '}') {
                    inRootBlock = false;
                    // Add a newline before the closing brace if the last line wasn't empty
                    if (newLines.length > 0 && newLines[newLines.length - 1].trim() !== '') {
                        newLines.push('');
                    }
                    newLines.push(line);
                    continue;
                }

                if (inRootBlock && line.trim().startsWith('--')) {
                    const cssVariable = line.trim().split(':')[0]; // e.g., --color-white
                    let currentPrefix = null;

                    // Find which group the variable belongs to
                    for (const prefix in tokenGroupComments) {
                        if (cssVariable.startsWith(`--${prefix}`)) {
                            currentPrefix = prefix;
                            break;
                        }
                    }

                    // If this is a new group, add the comment
                    if (currentPrefix && currentPrefix !== lastMatchedPrefix) {
                        // Add a blank line for separation before the new group comment
                        if (lastMatchedPrefix !== null) {
                            newLines.push('');
                        }
                        newLines.push(`  /* ${tokenGroupComments[currentPrefix]} */`);
                        lastMatchedPrefix = currentPrefix;
                    }
                }
                newLines.push(line);
            }

            const newContent = newLines.join('\n');
            await fs.writeFile(filePath, newContent, 'utf-8');
        } catch (error) {
            console.error(`❌ Error processing ${filePath}:`, error);
        }
    }
    console.log(`✅ Comments added to ${cssFiles.length} CSS file(s).`);
}

/**
 * This function adds comments to XML files to group resources.
 */
async function addCommentsToXml() {
    console.log('\n✏️  Adding comments to generated XML files...');

    // Mapping of resource name prefixes to their desired comment.
    // These prefixes correspond to the token names after the 'name/android/snake' transform.
    const tokenGroupComments = {
        'color_': 'primitive color',
        'typography_': 'primitive typography',
        'colors_': 'semantic color',
        'border_radius_': 'semantic border radius',
        'spacing_': 'semantic spacing',
    };

    const xmlFiles = await glob('build/**/*.xml');

    if (xmlFiles.length === 0) {
        console.warn('⚠️ No ".xml" files found to add comments to.');
        return;
    }

    for (const filePath of xmlFiles) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n');
            const newLines = [];
            let inResourcesBlock = false;
            let lastMatchedPrefix = null;

            for (const line of lines) {
                if (line.trim().startsWith('<resources')) {
                    inResourcesBlock = true;
                    newLines.push(line);
                    continue;
                }

                if (line.trim() === '</resources>') {
                    inResourcesBlock = false;
                    if (newLines.length > 0 && newLines[newLines.length - 1].trim() !== '') {
                        newLines.push('');
                    }
                    newLines.push(line);
                    continue;
                }

                if (inResourcesBlock && line.trim().startsWith('<')) {
                    const nameMatch = line.match(/name="([^"]+)"/);
                    if (nameMatch) {
                        const resourceName = nameMatch[1]; // e.g., color_white
                        const currentPrefix = Object.keys(tokenGroupComments).find(p => resourceName.startsWith(p));

                        if (currentPrefix && currentPrefix !== lastMatchedPrefix) {
                            if (lastMatchedPrefix !== null) newLines.push('');
                            newLines.push(`  <!-- ${tokenGroupComments[currentPrefix]} -->`);
                            lastMatchedPrefix = currentPrefix;
                        }
                    }
                }
                newLines.push(line);
            }

            await fs.writeFile(filePath, newLines.join('\n'), 'utf-8');
        } catch (error) {
            console.error(`❌ Error processing ${filePath}:`, error);
        }
    }
    console.log(`✅ Comments added to ${xmlFiles.length} XML file(s).`);
}

/**
 * This function adds comments to Swift files to group token properties.
 */
async function addCommentsToSwift() {
    console.log('\n✏️  Adding comments to generated Swift files...');

    // Mapping of property name prefixes to their desired comment.
    // These prefixes correspond to the token names after the 'name/cti/camel' transform.
    const tokenGroupComments = {
        'color': 'Primitive color',
        'typography': 'Primitive typography',
        'colors': 'Semantic color',
        'borderRadius': 'Semantic border radius',
        'spacing': 'Semantic spacing',
    };

    // Find all StyleDictionary.swift files in the build directory
    const swiftFiles = await glob('build/**/StyleDictionary.swift');

    if (swiftFiles.length === 0) {
        console.warn('⚠️ No "StyleDictionary.swift" files found to add comments to.');
        return;
    }

    for (const filePath of swiftFiles) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n');
            const newLines = [];
            let inClassBlock = false;
            let lastMatchedPrefix = null;

            for (const line of lines) {
                if (line.trim().startsWith('public class')) {
                    inClassBlock = true;
                    newLines.push(line);
                    continue;
                }

                if (inClassBlock && line.trim() === '}') {
                    inClassBlock = false;
                    if (newLines.length > 0 && newLines[newLines.length - 1].trim() !== '') newLines.push('');
                    newLines.push(line);
                    continue;
                }

                if (inClassBlock && line.trim().startsWith('public static let')) {
                    const nameMatch = line.match(/public static let (\w+)/);
                    if (nameMatch) {
                        const propertyName = nameMatch[1]; // e.g., colorBlack
                        const currentPrefix = Object.keys(tokenGroupComments).find(p => propertyName.startsWith(p));

                        if (currentPrefix && currentPrefix !== lastMatchedPrefix) {
                            if (lastMatchedPrefix !== null) newLines.push('');
                            newLines.push(`    // ${tokenGroupComments[currentPrefix]}`);
                            lastMatchedPrefix = currentPrefix;
                        }
                    }
                }
                newLines.push(line);
            }
            await fs.writeFile(filePath, newLines.join('\n'), 'utf-8');
        } catch (error) {
            console.error(`❌ Error processing ${filePath}:`, error);
        }
    }
    console.log(`✅ Comments added to ${swiftFiles.length} Swift file(s).`);
}

async function buildAll() {
    const buildDir = './build';
    console.log('\n🔄 Rebuilding tokens for ALL brands & platforms...');
    
    await fs.mkdir(buildDir, { recursive: true }).catch(() => {});
    const tokenData = await loadTokens();
    const themesIndex = await buildThemes(tokenData);

    buildBase(tokenData.primitiveFiles);
    buildThemePlatforms(themesIndex);
    await addCommentsToCss();
    await addCommentsToXml();
    await addCommentsToSwift();

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