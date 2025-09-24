import { fileHeader } from './header-comment.js';

/**
 * Helper function to check if a value is a string and contains a reference.
 * A reference is a string that starts with '{' and ends with '}'.
 * @param {any} value
 * @returns {boolean}
 */
function isReference(value) {
  return typeof value === 'string' && value.startsWith('{') && value.endsWith('}');
}

/**
 * Recursively adds `isReference` and `originalValue` metadata to each token.
 * This is useful for formatters to know if a token is a reference and what its original value was.
 * @param {object} obj - The token object to traverse.
 */
function addReferenceMetadata(obj) {
  for (const key in obj) {
    if (!obj.hasOwnProperty(key)) continue;

    const prop = obj[key];
    if (prop.hasOwnProperty('value')) { // It's a token
      prop.isReference = isReference(prop.value);
      prop.originalValue = prop.value; // Keep track of original value before it's resolved
    } else if (typeof prop === 'object' && prop !== null) {
      addReferenceMetadata(prop);
    }
  }
}

/**
 * Custom formatter for CSS variables.
 * - Outputs CSS variables inside :root.
 * - Supports `outputReferences: true` to convert token references into var(--token-name) syntax.
 * - Adds a comment after each CSS variable if the token is a reference, showing its original value.
 */
export const cssVariablesWithRefs = {
  name: 'custom/css/variables-with-refs',
  format: function({ dictionary, file, options }) {
    const { outputReferences } = options;

    const header = file.options.fileHeader();

    const tokens = dictionary.allTokens.map(token => {
      let value = token.value;
      let comment = '';

      // In Style Dictionary v4+, we should check the original value for references.
      // The `token.value` will be resolved.
      const originalValue = token.original.value;
      if (isReference(originalValue)) {
        comment = ` /* ref: ${originalValue} */`;
        if (outputReferences) {
          // For Style Dictionary v4+, we need to find the reference in the dictionary.
          // The 'getReferences' method is no longer available.
          const referencePath = originalValue.replace(/[{}]/g, '');
          const ref = dictionary.allTokens.find(t => t.path.join('.') === referencePath);
          if (ref) { // If the reference is found
            value = `var(--${ref.name})`;
          }
        }
      }

      return `  --${token.name}: ${value};${comment}`;
    }).join('\n');

    return `/*
 * ${header.join('\n * ')}
 */
:root {
${tokens}
}
`;
  }
};

/**
 * Custom formatter for Swift.
 * - Outputs Swift constants in a struct Tokens { ... } format.
 * - Each token becomes a static let constant.
 * - If a token is a reference, outputs a comment above it with its original reference path.
 */
export const swiftTokens = {
  name: 'custom/swift/tokens',
  format: function({ dictionary, file, options }) {
    const header = file.options.fileHeader();

    const tokens = dictionary.allTokens.map(token => {
      let value = token.value;
      let comment = '';

      const originalValue = token.original.value;
      if (isReference(originalValue)) {
        comment = ` // ref: ${originalValue}`;
      }

      // Assumes transforms like 'color/swift', 'size/swift' have been run
      // to format the value correctly (e.g., UIColor(...) or CGFloat(...)).
      return `    public static let ${token.name} = ${value}${comment}`;
    }).join('\n');

    return `/*
 * ${header.join('\n * ')}
 */

import UIKit

public struct Tokens {
${tokens}
}
`;
  }
};

/**
 * Custom formatter for Android XML.
 * - Outputs an xml/resources file.
 * - Colors use <color name="token_name">#hex</color>.
 * - Dimensions use <dimen name="token_name">8dp</dimen>.
 * - If a token is a reference, adds an XML comment above it with the original reference path.
 */
export const androidResources = {
  name: 'custom/android/resources',
  format: function({ dictionary, file, options }) {
    const header = file.options.fileHeader();

    const getResourceType = (token) => {
      // You can expand this logic based on your token types
      switch (token.type) {
        case 'color':
          return 'color';
        case 'dimension':
        case 'sizing':
        case 'spacing':
        case 'borderRadius':
          return 'dimen';
        default:
          return 'string';
      }
    };

    const tokens = dictionary.allTokens.map(token => {
      const resourceType = getResourceType(token);
      let comment = '';

      const originalValue = token.original.value;
      if (isReference(originalValue)) {
        comment = ` <!-- ref: ${originalValue} -->`;
      }

      return `    <${resourceType} name="${token.name}">${token.value}</${resourceType}>${comment}`;
    }).join('\n');

    return `<?xml version="1.0" encoding="utf-8"?>\n<!--
  ~ ${header.join('\n  ~ ')}
  -->

<resources>
${tokens}
</resources>
`;
  }
};

/**
 * Registers all custom formatters with a Style Dictionary instance.
 * @param {StyleDictionary} sd - The Style Dictionary instance.
 */
export function registerCustomFormats(sd) {
  sd.registerFormat(cssVariablesWithRefs);
  sd.registerFormat(swiftTokens);
  sd.registerFormat(androidResources);
}