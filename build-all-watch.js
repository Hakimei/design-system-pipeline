import fs from 'fs/promises';
import path from 'path';
import chokidar from 'chokidar';
import StyleDictionary from 'style-dictionary';
import tinycolor from 'tinycolor2';
import {
  registerCustomFormats
} from './ref-comment.js';
import { fileHeader } from './header-comment.js';

StyleDictionary.registerTransform({
    name: 'color/hexToRgba',
    type: 'value',
    filter: (token) => token.type === 'color',
    transform: (token) => {
        const color = tinycolor(token.value);
        // toRgbString() automatically handles alpha and returns
        // 'rgba(...)' if alpha is < 1, or 'rgb(...)' if alpha is 1.
        return color.toRgbString();
    }
});

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

StyleDictionary.registerTransform({
    name: 'swift/fontWeight',
    type: 'value',
    filter: (token) => token.type === 'fontWeight',
    transform: (token) => {
        const weightMap = {
            '100': 'ultraLight', '200': 'thin', '300': 'light',
            '400': 'regular', '500': 'medium', '600': 'semibold',
            '700': 'bold', '800': 'heavy', '900': 'black'
        };
        // In composite typography tokens, the value is already the final one.
        const value = token.original.value;
        if (weightMap[value]) {
            return `.${weightMap[value]}`;
        }
        console.warn(`Unsupported font weight: ${value}. Defaulting to .regular.`);
        return '.regular';
    }
});

StyleDictionary.registerTransform({
    name: 'swift/shadow',
    type: 'value',
    filter: (token) => token.type === 'shadow',
    transform: (token) => {
        const layers = Array.isArray(token.value) ? token.value : [token.value];
        return `[\n${layers
            .map(l => {
                const blur = parseFloat(l.blur);
                const radius = blur / 2;
                const color = l.color.slice(0, 7);
                const alpha = parseInt(l.color.slice(7, 9), 16) / 255 || 1;
                return `    ShadowLayer(offset: CGSize(width: ${parseFloat(l.offsetX)}, height: ${parseFloat(l.offsetY)}), radius: ${radius}, color: UIColor(hex: "${color}").withAlphaComponent(${alpha}), inset: ${l.inset || false})`;
            })
            .join(',\n')}\n  ]`;
    }
});

StyleDictionary.registerTransform({
    name: 'shadow/css/shorthandWithRgba',
    type: 'value',
    filter: (token) => token.type === 'shadow',
    transform: (token) => {
        const layers = Array.isArray(token.value) ? token.value : [token.value];
        return layers.map(layer => {
            const { offsetX, offsetY, blur, spread, color, inset } = layer;
            const colorValue = tinycolor(color).toRgbString();
            return `${inset ? 'inset ' : ''}${offsetX} ${offsetY} ${blur} ${spread || ''} ${colorValue}`.trim().replace(/ +/g, ' ');
        }).join(', ');
    }
});

// Register the custom transform group
StyleDictionary.registerTransformGroup({
    name: 'custom/css',
    transforms: [
        'attribute/cti',
        'name/kebab',
        'color/hexToRgba',
        'size/pxToRem',
        'ts/size/lineheight', // Corrected typo from previous step
        'shadow/css/shorthandWithRgba'
    ]
});

StyleDictionary.registerTransformGroup({
    name: 'custom/android',
    transforms: ['size/pxToRem'].concat(
        StyleDictionary.hooks.transformGroups['android'],
        [
            'ts/size/lineheight'
        ]
    )
});

StyleDictionary.registerTransformGroup({
    name: 'custom/ios-swift',
    transforms: ['size/pxToRem'].concat(StyleDictionary.hooks.transformGroups['ios-swift'], ['ts/size/lineheight', 'swift/fontWeight', 'swift/shadow'])
});

registerCustomFormats(StyleDictionary);

// Register a custom format that combines CSS variables and typography classes for themes.
StyleDictionary.registerFormat({
  name: 'custom/css/typography-classes',
  format: function({ dictionary, file }) {
    const header = file.options.fileHeader();
    const isReference = (value) => typeof value === 'string' && value.startsWith('{') && value.endsWith('}');

    const classes = dictionary.allTokens
      .map(token => {
        const properties = Object.entries(token.value).map(([prop, value]) => {
          const originalValue = token.original.value[prop];
          let comment = '';
          if (originalValue && isReference(originalValue)) {
            comment = ` /* ref: ${originalValue} */`;
          }
          const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
          return `  ${cssProp}: ${value};${comment}`;
        }).join('\n');
        return `.${token.name} {\n${properties}\n}`;
      })
      .join('\n');
    let output = `/*\n * ${header.join('\n * ')}\n */\n${classes}\n`;

    return output;
  }
});

// Register a custom format for Android to create <style> resources for typography
StyleDictionary.registerFormat({
  name: 'custom/android/styles',
  format: function({ dictionary, file }) {
    const header = file.options.fileHeader();
    const isReference = (value) => typeof value === 'string' && value.startsWith('{') && value.endsWith('}');
    const toSnakeCase = (str) => str.replace(/([A-Z])/g, '_$1').toLowerCase();

    const styles = dictionary.allTokens
      .filter(token => token.type === 'typography')
      .map(token => {
        const properties = Object.entries(token.value)
          .map(([prop, value]) => {
            const originalValue = token.original.value[prop];
            let comment = '';
            if (originalValue && isReference(originalValue)) {
              comment = ` <!-- ref: ${originalValue} -->`;
            }
            // Map token properties to Android XML attributes
            const androidPropMap = {
              fontFamily: 'android:fontFamily',
              fontWeight: 'android:textStyle', // This might need a transform to map 400->normal, 700->bold
              fontSize: 'android:textSize',
              letterSpacing: 'android:letterSpacing',
              lineHeight: 'android:lineHeight', // Requires API 28+, value should be a dimension
            };
            const androidProp = androidPropMap[prop] || `item_unmapped_${prop}`;
            return `    <item name="${androidProp}">${value}</item>${comment}`;
          })
          .join('\n');
        return `  <style name="${token.name.replace(/-/g, '_')}">\n${properties}\n  </style>`;
      })
      .join('\n');

    return `<?xml version="1.0" encoding="utf-8"?>\n<!--\n  ~ ${header.join('\n  ~ ')}\n  -->\n<resources>\n${styles}\n</resources>`;
  }
});

// Register a custom format for Android to create <style> resources for shadows
StyleDictionary.registerFormat({
    name: 'custom/android/shadows',
    format: function({ dictionary, file }) {
        const header = file.options.fileHeader();
        const styles = dictionary.allTokens
            .filter(token => token.type === 'shadow')
            .map(token => {
                const layers = Array.isArray(token.value) ? token.value : [token.value];
                const properties = layers.map((l, i) => {
                    const layerNum = i + 1;
                    return `    <item name="offset_x_layer${layerNum}">${parseFloat(l.offsetX)}dp</item>
    <item name="offset_y_layer${layerNum}">${parseFloat(l.offsetY)}dp</item>
    <item name="blur_layer${layerNum}">${parseFloat(l.blur)}dp</item>
    <item name="color_layer${layerNum}">${l.color}</item>
    <item name="inset_layer${layerNum}">${l.inset || false}</item>`;
                }).join('\n');

                return `  <style name="${token.name.replace(/-/g, '_')}">\n${properties}\n  </style>`;
            })
            .join('\n');

        return `<?xml version="1.0" encoding="utf-8"?>\n<!--\n  ~ ${header.join('\n  ~ ')}\n  -->\n<resources>\n${styles}\n</resources>`;
    }
});

// Register a custom format for Swift to create Text Style ViewModifiers
StyleDictionary.registerFormat({
  name: 'custom/swift/textstyles',
  format: function({ dictionary, file }) {
    const header = file.options.fileHeader();
    const isReference = (value) => typeof value === 'string' && value.startsWith('{') && value.endsWith('}');
    const toCamelCase = (str) => str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());

    const styles = dictionary.allTokens
      .filter(token => token.type === 'typography')
      .map(token => {
        const original = token.original.value;

        const getComment = (prop) => {
          const originalValue = original[prop];
          if (originalValue && isReference(originalValue)) {
            return ` // ref: ${originalValue}`;
          }
          return '';
        };

        // The 'ts/size/lineheight' transform converts '%' to a number, which is what .lineSpacing expects
        // For lineSpacing, we need to calculate it based on fontSize if it's a relative value.
        // Assuming your lineheight transform already handles this correctly.
        const lineHeight = token.value.lineHeight; // This is already transformed
        const structName = toCamelCase(token.name.charAt(0).toUpperCase() + token.name.slice(1));

        return `struct ${structName}Style: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.system(size: ${token.value.fontSize}, weight: ${token.value.fontWeight}))${getComment('fontSize')}${getComment('fontWeight')}
            .lineSpacing(${lineHeight})${getComment('lineHeight')}
            .tracking(${token.value.letterSpacing})${getComment('letterSpacing')}
    }
}`;
      }).join('\n\n');

    return `/*\n * ${header.join('\n * ')}\n */\n\nimport SwiftUI\n\n${styles}\n`;
  }
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

/**
 * Reads all .json files in a directory, parses them, and returns an object
 * where keys are filenames (without extension) and values are file contents.
 */
async function readJsonFilesFromDir(directory) {
    const files = await fs.readdir(directory);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    const fileContents = await Promise.all(jsonFiles.map(async (file) => {
        const filePath = path.join(directory, file);
        const content = await fs.readFile(filePath, 'utf8');
        return {
            name: path.basename(file, '.json'),
            data: JSON.parse(content)
        };
    }));
    return fileContents.reduce((acc, { name, data }) => {
        acc[name] = data;
        return acc;
    }, {});
}

/**
 * Reads and merges all .json files from a directory into a single object.
 */
async function mergeJsonFilesFromDir(directory) {
    const files = await fs.readdir(directory);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    const contents = await Promise.all(
        jsonFiles.map(file => fs.readFile(path.join(directory, file), 'utf8').then(JSON.parse))
    );
    return contents.reduce((acc, content) => mergeDeep(acc, content), {});
}

async function loadTokens() {
    const tokensDir = './tokens';
    const aliasDir = path.join(tokensDir, 'alias');
    const primitivesDir = path.join(tokensDir, 'primitives');
    const componentsDir = path.join(tokensDir, 'components');

    const primitiveFilesPaths = (await fs.readdir(primitivesDir)).filter(file => file.endsWith('.json')).map(file => path.join(primitivesDir, file));

    const [primitiveTokens, aliasTokens, brands, modes, shapes, densities, componentTokens] = await Promise.all([
        mergeJsonFilesFromDir(primitivesDir),
        mergeJsonFilesFromDir(aliasDir),
        readJsonFilesFromDir(path.join(tokensDir, 'alias', 'brands')),
        readJsonFilesFromDir(path.join(tokensDir, 'semantic', 'modes')),
        readJsonFilesFromDir(path.join(tokensDir, 'semantic', 'shapes')),
        readJsonFilesFromDir(path.join(tokensDir, 'semantic', 'densities')),
        mergeJsonFilesFromDir(componentsDir)
    ]);

    return { primitiveTokens, aliasTokens, primitiveFilesPaths, brands, modes, shapes, densities, componentTokens };
}

function addMetadata(targetObj, sourceObj, metadataKey, metadataValue) {
    for (const key in sourceObj) {
        if (Object.prototype.hasOwnProperty.call(sourceObj, key) && Object.prototype.hasOwnProperty.call(targetObj, key)) {
            if (Object.prototype.hasOwnProperty.call(sourceObj[key], 'value')) { // This is a token
                targetObj[key].attributes = targetObj[key].attributes || {};
                targetObj[key].attributes[metadataKey] = metadataValue;
            } else if (typeof sourceObj[key] === 'object' && sourceObj[key] !== null) { // This is a category
                addMetadata(targetObj[key], sourceObj[key], metadataKey, metadataValue);
            }
        }
    }
}

async function buildThemes(tokenData) {
    const { primitiveTokens, aliasTokens, brands, modes, shapes, densities, componentTokens } = tokenData;
    const buildDir = './build';
    const themesIndex = {};

    // --- Merge and Build Themes ---
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

                    const finalTokens = JSON.parse(JSON.stringify(merged)); // Deep copy
                    addMetadata(finalTokens, primitiveTokens, 'isPrimitive', true);
                    addMetadata(finalTokens, aliasTokens, 'isAlias', true);

                    // Mark other tokens as not primitive and not alias
                    [brandTokens, modeTokens, shapeTokens, densityTokens, componentTokens].forEach(tokenSet => {
                        addMetadata(finalTokens, tokenSet, 'isPrimitive', false);
                        addMetadata(finalTokens, tokenSet, 'isAlias', false);
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

function buildGlobal(tokens) {
    console.log('\nBuilding global primitive tokens...');
    const buildDir = './build';
    const globalBuildPath = `${buildDir}/global/`;
    const SDGlobal = new StyleDictionary({
        tokens: tokens,
        platforms: {
            css: {
                transformGroup: 'custom/css',
                buildPath: globalBuildPath,
                files: [{
                    destination: 'variables.css',
                    format: 'custom/css/variables-with-refs',
                    options: {
                        fileHeader: () => fileHeader(['Contains: primitive tokens']),
                        outputReferences: false,
                    },
                    filter: (token) => token.attributes.isPrimitive,
                }]
            },
            android: {
                transformGroup: 'custom/android',
                buildPath: globalBuildPath,
                files: [{
                    destination: 'variables.xml',
                    format: 'custom/android/resources',
                    options: {
                        fileHeader: () => fileHeader(['Contains: primitive tokens']),
                        outputReferences: false,
                    },
                    filter: (token) => token.attributes.isPrimitive,
                }]
            },
            ios: {
                transformGroup: 'custom/ios-swift',
                buildPath: globalBuildPath,
                files: [{
                    destination: 'variables.swift',
                    format: 'custom/swift/tokens',
                    options: {
                        fileHeader: () => fileHeader(['Contains: primitive tokens']),
                        outputReferences: false,
                    },
                    filter: (token) => token.attributes.isPrimitive,
                }]
            }
        }
    });
    SDGlobal.buildAllPlatforms();
    console.log(`✅ Built global primitives for Web/Android/iOS`);
}

function buildBase(tokens) {
    console.log('\nBuilding base alias tokens...');
    const buildDir = './build';
    const baseBuildPath = `${buildDir}/base/`;
    const SDBase = new StyleDictionary({
        tokens: tokens,
        platforms: {
            css: {
                transformGroup: 'custom/css',
                buildPath: baseBuildPath,
                files: [{
                    destination: 'variables.css',
                    format: 'custom/css/variables-with-refs',
                    options: {
                        fileHeader: () => fileHeader(['Contains: alias (base) tokens that reference primitives']),
                        outputReferences: false,
                    },
                    filter: (token) => token.attributes.isAlias,
                }]
            },
            android: {
                transformGroup: 'custom/android',
                buildPath: baseBuildPath,
                files: [{
                    destination: 'variables.xml',
                    format: 'custom/android/resources',
                    options: {
                        fileHeader: () => fileHeader(['Contains: alias (base) tokens']),
                        outputReferences: false,
                    },
                    filter: (token) => token.attributes.isAlias,
                }]
            },
            ios: {
                transformGroup: 'custom/ios-swift',
                buildPath: baseBuildPath,
                files: [{
                    destination: 'variables.swift',
                    format: 'custom/swift/tokens',
                    options: {
                        fileHeader: () => fileHeader(['Contains: alias (base) tokens']),
                        outputReferences: false,
                    },
                    filter: (token) => token.attributes.isAlias,
                }]
            }
        }
    });
    SDBase.buildAllPlatforms();
    console.log(`✅ Built base aliases for Web/Android/iOS`);
}

function buildThemePlatforms(themesIndex) {
    const buildDir = './build';
    console.log('\nBuilding themed tokens for all platforms...');
    Object.entries(themesIndex).forEach(([themeName, filePath]) => {
        const [brand, mode, shape, density] = themeName.split('-');
        const rest = [mode, shape, density];
        const subTheme = rest.join('-');
        const newBuildPath = `${buildDir}/${brand}/${subTheme}/`;

        const SD = new StyleDictionary({
            source: [`${buildDir}/${filePath.replace('./', '')}`],
            platforms: {
                css: {
                    transformGroup: 'custom/css',
                    buildPath: newBuildPath,
                    files: [{
                        destination: 'web/variables.css',
                        format: 'custom/css/variables-with-refs',
                        options: {
                            fileHeader: () => fileHeader([
                                `Brand: ${brand}`,
                                `Mode: ${mode}`,
                                `Shape: ${shape}`,
                                `Density: ${density}`,
                            ]),
                            outputReferences: true, // References are resolved in theme files
                        },
                        filter: (token) => !token.attributes.isPrimitive && !token.attributes.isAlias && !['typography', 'shadow'].includes(token.type),
                    }, {
                        destination: 'web/text-styles.css',
                        format: 'custom/css/typography-classes',
                        options: {
                            fileHeader: () => fileHeader([
                                `Brand: ${brand}`,
                                `Mode: ${mode}`,
                                `Shape: ${shape}`,
                                `Density: ${density}`,
                            ]),
                        },
                        filter: (token) => !token.attributes.isPrimitive && !token.attributes.isAlias && token.type === 'typography',
                    }, {
                        destination: 'web/effect-styles.css',
                        format: 'css/variables',
                        options: {
                            fileHeader: () => fileHeader([
                                `Brand: ${brand}`,
                                `Mode: ${mode}`,
                                `Shape: ${shape}`,
                                `Density: ${density}`,
                            ]),
                            outputReferences: true,
                        },
                        filter: (token) => !token.attributes.isPrimitive && !token.attributes.isAlias && token.type === 'shadow',
                    }
                    ]
                },
                android: {
                    transformGroup: 'custom/android',
                    buildPath: newBuildPath,
                    files: [{
                        destination: 'android/variables.xml',
                        format: 'custom/android/resources',
                        options: {
                            fileHeader: () => fileHeader([
                                `Brand: ${brand}`,
                                `Mode: ${mode}`,
                                `Shape: ${shape}`,
                                `Density: ${density}`,
                            ]),
                            outputReferences: false,
                        },
                        // Exclude primitive and alias tokens to avoid duplication
                        filter: (token) => !token.attributes.isPrimitive && !token.attributes.isAlias && !['typography', 'shadow'].includes(token.type),
                    }, {
                        destination: 'android/text-styles.xml',
                        format: 'custom/android/styles',
                        options: {
                            fileHeader: () => fileHeader([
                                `Brand: ${brand}`,
                                `Mode: ${mode}`,
                                `Shape: ${shape}`,
                                `Density: ${density}`,
                            ]),
                        },
                        // Only include composite typography tokens
                        filter: (token) => !token.attributes.isPrimitive && !token.attributes.isAlias && token.type === 'typography',
                    }, {
                        destination: 'android/effect-styles.xml',
                        format: 'custom/android/shadows',
                        options: {
                            fileHeader: () => fileHeader([
                                `Brand: ${brand}`,
                                `Mode: ${mode}`,
                                `Shape: ${shape}`,
                                `Density: ${density}`,
                            ]),
                        },
                        // Only include shadow tokens
                        filter: (token) => !token.attributes.isPrimitive && !token.attributes.isAlias && token.type === 'shadow',
                    }]
                },
                ios: {
                    transformGroup: 'custom/ios-swift',
                    buildPath: newBuildPath,
                    files: [{
                        destination: 'ios/variables.swift',
                        format: 'custom/swift/tokens',
                        className: 'StyleDictionary',
                        options: {
                            fileHeader: () => fileHeader([
                                `Brand: ${brand}`,
                                `Mode: ${mode}`,
                                `Shape: ${shape}`,
                                `Density: ${density}`,
                            ]),
                            outputReferences: false,
                        },
                        // Exclude primitive and alias tokens to avoid duplication
                        filter: (token) => !token.attributes.isPrimitive && !token.attributes.isAlias && !['typography', 'shadow'].includes(token.type),
                    }, {
                        destination: 'ios/text-styles.swift',
                        format: 'custom/swift/textstyles',
                        options: {
                            fileHeader: () => fileHeader([
                                `Brand: ${brand}`,
                                `Mode: ${mode}`,
                                `Shape: ${shape}`,
                                `Density: ${density}`,
                            ]),
                        },
                        // Only include composite typography tokens
                        filter: (token) => !token.attributes.isPrimitive && !token.attributes.isAlias && token.type === 'typography',
                    }, {
                        destination: 'ios/effect-styles.swift',
                        format: 'custom/swift/tokens',
                        className: 'Tokens',
                        options: {
                            fileHeader: () => fileHeader([
                                `Brand: ${brand}`,
                                `Mode: ${mode}`,
                                `Shape: ${shape}`,
                                `Density: ${density}`,
                            ]),
                            outputReferences: false,
                            // Prepend the ShadowLayer struct definition
                            fileHeader: (defaultMessage = []) => defaultMessage.concat(['struct ShadowLayer {', '  let offset: CGSize', '  let radius: CGFloat', '  let color: UIColor', '  let inset: Bool', '}']),
                        },
                        // Only include shadow tokens
                        filter: (token) => !token.attributes.isPrimitive && !token.attributes.isAlias && token.type === 'shadow',
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

    // Create a single, fully-merged token object with all metadata first.
    const allTokens = mergeDeep(tokenData.primitiveTokens, tokenData.aliasTokens);
    addMetadata(allTokens, tokenData.primitiveTokens, 'isPrimitive', true);
    addMetadata(allTokens, tokenData.aliasTokens, 'isAlias', true);
    // Ensure all tokens have the attributes defined, even if false.
    addMetadata(allTokens, tokenData.primitiveTokens, 'isAlias', false);
    addMetadata(allTokens, tokenData.aliasTokens, 'isPrimitive', false);

    const themesIndex = await buildThemes(tokenData);
    
    // Now, build the global and base files from the pre-processed token object.
    buildGlobal(allTokens);
    buildBase(allTokens);
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