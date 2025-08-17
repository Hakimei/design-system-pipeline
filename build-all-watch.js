import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';
import StyleDictionary from 'style-dictionary';

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

const tokensDir = './tokens';
const buildDir = './build';

function mergeDeep(target, source) {
    const output = { ...target };

    if (target instanceof Object && source instanceof Object) {
        for (const key in source) {
            if (source[key] instanceof Object) {
                if (key in target && target[key] instanceof Object) {
                    output[key] = mergeDeep(target[key], source[key]);
                } else {
                    output[key] = source[key];
                }
            } else {
                output[key] = source[key];
            }
        }
    }

    return output;
}

function buildAll() {
    console.log('\n🔄 Rebuilding tokens for ALL brands & platforms...');

    if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir);

    // Dynamic detection for brands, modes, and densities
    const brandsDir = path.join(tokensDir, 'brands');
    const brandFiles = fs.readdirSync(brandsDir);
    const brands = brandFiles.filter(file => file.endsWith('.json')).map(file => path.basename(file, '.json'));

    const modesDir = path.join(tokensDir, 'modes');
    const modeFiles = fs.readdirSync(modesDir);
    const modes = modeFiles.filter(file => file.endsWith('.json')).map(file => path.basename(file, '.json'));

    const shapesDir = path.join(tokensDir, 'shapes');
    const shapeFiles = fs.readdirSync(shapesDir);
    const shapes = shapeFiles.filter(file => file.endsWith('.json')).map(file => path.basename(file, '.json'));

    const densitiesDir = path.join(tokensDir, 'densities');
    const densityFiles = fs.readdirSync(densitiesDir);
    const densities = densityFiles.filter(file => file.endsWith('.json')).map(file => path.basename(file, '.json'));

    const componentsDir = path.join(tokensDir, 'components');
    const componentFiles = fs.readdirSync(componentsDir).filter(file => file.endsWith('.json'));
    const componentTokens = componentFiles.reduce((acc, file) => {
        const componentPath = path.join(componentsDir, file);
        const componentTokenData = JSON.parse(fs.readFileSync(componentPath, 'utf8'));
        console.log(`🧬 Merging component tokens from ${file}`);
        return mergeDeep(acc, componentTokenData);
    }, {});

    const themesIndex = {};

    brands.forEach(brand => {
        const brandTokens = JSON.parse(fs.readFileSync(path.join(brandsDir, `${brand}.json`), 'utf8'));

        modes.forEach(mode => {
            shapes.forEach(shape => {
                densities.forEach(density => {
                    const modeTokens = JSON.parse(fs.readFileSync(path.join(modesDir, `${mode}.json`), 'utf8'));
                    const densityTokens = JSON.parse(fs.readFileSync(path.join(densitiesDir, `${density}.json`), 'utf8'));
                    const shapeTokens = JSON.parse(fs.readFileSync(path.join(shapesDir, `${shape}.json`), 'utf8'));

                    let merged = mergeDeep(brandTokens, modeTokens);
                    merged = mergeDeep(merged, shapeTokens);
                    merged = mergeDeep(merged, densityTokens);
                    merged = mergeDeep(merged, componentTokens);

                    const themeName = `${brand}-${mode}-${shape}-${density}`;
                    const fileName = `token/${themeName}.json`;
                    const filePath = `${buildDir}/${fileName}`;
                    const fileDir = path.dirname(filePath);

                    if (!fs.existsSync(fileDir)) {
                        fs.mkdirSync(fileDir, { recursive: true });
                    }

                    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2));
                    themesIndex[themeName] = `./${fileName}`;

                    console.log(`✅ Merged ${fileName}`);
                });
            });
        });
    });

    fs.writeFileSync(`${buildDir}/themes.json`, JSON.stringify(themesIndex, null, 2));
    console.log(`✅ Updated themes.json`);

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
                    files: [{ destination: 'variables.css', format: 'css/variables' }]
                },
                android: {
                    transformGroup: 'custom/android',
                    buildPath: newBuildPath,
                    files: [{ destination: 'tokens.xml', format: 'android/resources' }]
                },
                ios: {
                    transformGroup: 'custom/ios-swift',
                    buildPath: newBuildPath,
                    files: [{
                        destination: 'StyleDictionary.swift',
                        format: 'ios-swift/class.swift',
                        className: 'StyleDictionary',
                        type: 'class'
                    }]
                }
            }
        });

        SD.buildAllPlatforms();
        console.log(`✅ Built Web/Android/iOS for ${themeName}`);
    });

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

// Watch for changes
console.log('👀 Watching for token changes...');
chokidar
    .watch(`${tokensDir}/**/*.json`)
    .on('change', handleFileChange);