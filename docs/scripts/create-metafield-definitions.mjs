#!/usr/bin/env node
/**
 * create-metafield-definitions.mjs
 *
 * Creates the Coszus metafield and metaobject DEFINITIONS listed in
 * docs/METAFIELDS.md (HANDOFF section 8). It only creates definitions that are
 * missing. It never edits, deletes or fills in a definition, and never touches a
 * product, customer or any other store data.
 *
 * Definitions are store-wide, not per theme. Only run --apply with Kye's go-ahead.
 *
 * Usage (Node 18+, no dependencies):
 *   SHOPIFY_STORE=COSZUS-STORE.myshopify.com \
 *   SHOPIFY_ADMIN_TOKEN=... \
 *   node docs/scripts/create-metafield-definitions.mjs            # dry run: shows what exists and what would be created
 *   node docs/scripts/create-metafield-definitions.mjs --apply    # creates the missing definitions
 *
 * The token comes from a Dev Dashboard app installed on the store (client
 * credentials grant; see docs/METAFIELDS.md) with these Admin API scopes:
 *   read_metaobject_definitions, write_metaobject_definitions,
 *   read_products, write_products, read_customers, write_customers
 * (Shopify ties definition access to the owner resource. The script only calls
 * metaobjectDefinitionCreate and metafieldDefinitionCreate.)
 *
 * Optional: SHOPIFY_API_VERSION (default 2026-10).
 */

const STORE = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';
const APPLY = process.argv.includes('--apply');

/** Metaobject used by custom.size_guide. Must be created first. */
const SIZE_GUIDE = {
  type: 'size_guide',
  name: 'Size guide',
  description: 'Size table per product type. Referenced from products via custom.size_guide.',
  displayNameKey: 'name',
  // Liquid can only read metaobject entries when storefront access is on.
  access: { storefront: 'PUBLIC_READ' },
  // Not publishable: draft entries would read as nil in Liquid.
  capabilities: { publishable: { enabled: false }, translatable: { enabled: true } },
  fieldDefinitions: [
    { key: 'name', name: 'Name', type: 'single_line_text_field', required: true },
    {
      key: 'unit',
      name: 'Unit',
      type: 'single_line_text_field',
      validations: [{ name: 'choices', value: JSON.stringify(['cm', 'in']) }],
    },
    {
      key: 'measured',
      name: 'Measurements are of',
      description: 'One line under the size guide title. Empty shows "Garment measurements, laid flat".',
      type: 'single_line_text_field',
    },
    {
      key: 'table',
      name: 'Table',
      description: 'One row per line, cells separated by | e.g. Size | Chest | Length. First line is the header.',
      type: 'multi_line_text_field',
    },
    { key: 'how_to_measure', name: 'How to measure', type: 'rich_text_field' },
    {
      key: 'image',
      name: 'Image',
      type: 'file_reference',
      validations: [{ name: 'file_type_options', value: JSON.stringify(['Image']) }],
    },
    { key: 'fit_notes', name: 'Fit notes', type: 'multi_line_text_field' },
  ],
};

/** Metafield definitions. `sizeGuide: true` gets the size_guide metaobject id as a validation. */
const METAFIELDS = [
  {
    ownerType: 'PRODUCT',
    namespace: 'custom',
    key: 'set_partner',
    name: 'Set partner',
    description: 'The matching piece (hoodie and joggers). Set it on both products. Drives Complete the set on the product page and in the bag.',
    type: 'product_reference',
    access: { storefront: 'PUBLIC_READ' },
    pin: true,
  },
  {
    ownerType: 'PRODUCT',
    namespace: 'custom',
    key: 'size_guide',
    name: 'Size guide',
    description: 'Size guide entry for this product type.',
    type: 'metaobject_reference',
    sizeGuide: true,
    access: { storefront: 'PUBLIC_READ' },
    pin: true,
  },
  {
    ownerType: 'PRODUCT',
    namespace: 'custom',
    key: 'fit_note',
    name: 'Fit note',
    description: 'Short fit line on the product page, e.g. Boxy fit.',
    type: 'single_line_text_field',
    access: { storefront: 'PUBLIC_READ' },
    pin: true,
  },
  {
    ownerType: 'PRODUCT',
    namespace: 'custom',
    key: 'model_info',
    name: 'Model info',
    description: 'e.g. Model is 6ft 1 and wears M.',
    type: 'single_line_text_field',
    access: { storefront: 'PUBLIC_READ' },
    pin: true,
  },
  {
    ownerType: 'PRODUCT',
    namespace: 'custom',
    key: 'flat_lay',
    name: 'Flat lay',
    description: 'Optional. Flat lay on grey for product cards. When empty, cards use the first product image.',
    type: 'file_reference',
    validations: [{ name: 'file_type_options', value: JSON.stringify(['Image']) }],
    access: { storefront: 'PUBLIC_READ' },
    pin: true,
  },
  {
    ownerType: 'PRODUCT',
    namespace: 'custom',
    key: 'badge',
    name: 'Badge',
    description: 'Text badge on product cards. Leave empty for none. Low stock is automatic.',
    type: 'single_line_text_field',
    validations: [{ name: 'choices', value: JSON.stringify(['New', 'Back in stock', 'Limited']) }],
    access: { storefront: 'PUBLIC_READ' },
    capabilities: { adminFilterable: { enabled: true }, smartCollectionCondition: { enabled: true } },
    pin: true,
  },
  {
    ownerType: 'CUSTOMER',
    namespace: 'custom',
    key: 'wishlist',
    name: 'Wishlist',
    description: 'Products the customer saved. Written by the wishlist feature, do not edit by hand.',
    type: 'list.product_reference',
    validations: [{ name: 'list.max', value: '100' }],
    access: { storefront: 'NONE' },
  },
];

const FIND_METAOBJECT = /* GraphQL */ `
  query FindMetaobjectDefinition($type: String!) {
    metaobjectDefinitionByType(type: $type) {
      id
      type
      name
    }
  }
`;

const FIND_METAFIELD = /* GraphQL */ `
  query FindMetafieldDefinition($ownerType: MetafieldOwnerType!, $namespace: String!, $key: String!) {
    metafieldDefinitions(first: 1, ownerType: $ownerType, namespace: $namespace, key: $key) {
      nodes {
        id
        key
        type {
          name
        }
      }
    }
  }
`;

const CREATE_METAOBJECT = /* GraphQL */ `
  mutation CreateMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $definition) {
      metaobjectDefinition {
        id
        type
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const CREATE_METAFIELD = /* GraphQL */ `
  mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        namespace
        key
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

async function admin(query, variables) {
  const response = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Admin API ${response.status}: ${await response.text()}`);
  const json = await response.json();
  if (json.errors) throw new Error(`Admin API error: ${JSON.stringify(json.errors)}`);
  return json.data;
}

function label(def) {
  return `${def.ownerType.toLowerCase()}.${def.namespace}.${def.key} (${def.type})`;
}

function checkUserErrors(result, what) {
  if (result.userErrors.length) {
    throw new Error(`${what}: ${result.userErrors.map((e) => `${e.field?.join('.')}: ${e.message}`).join('; ')}`);
  }
}

async function main() {
  if (!STORE || !TOKEN) {
    console.log('SHOPIFY_STORE and SHOPIFY_ADMIN_TOKEN are not set, so this only lists the definitions.\n');
    console.log(`metaobject ${SIZE_GUIDE.type} (${SIZE_GUIDE.fieldDefinitions.map((f) => f.key).join(', ')})`);
    for (const def of METAFIELDS) console.log(label(def));
    return;
  }

  console.log(`${APPLY ? 'Applying to' : 'Dry run against'} ${STORE} (API ${API_VERSION})\n`);

  // 1. size_guide metaobject definition
  let sizeGuideId = (await admin(FIND_METAOBJECT, { type: SIZE_GUIDE.type })).metaobjectDefinitionByType?.id;
  if (sizeGuideId) {
    console.log(`exists   metaobject ${SIZE_GUIDE.type}`);
  } else if (APPLY) {
    const result = (await admin(CREATE_METAOBJECT, { definition: SIZE_GUIDE })).metaobjectDefinitionCreate;
    checkUserErrors(result, `metaobject ${SIZE_GUIDE.type}`);
    sizeGuideId = result.metaobjectDefinition.id;
    console.log(`created  metaobject ${SIZE_GUIDE.type}`);
  } else {
    console.log(`missing  metaobject ${SIZE_GUIDE.type} (would create)`);
  }

  // 2. metafield definitions
  let conflicts = 0;
  for (const { sizeGuide, ...def } of METAFIELDS) {
    const existing = (await admin(FIND_METAFIELD, { ownerType: def.ownerType, namespace: def.namespace, key: def.key }))
      .metafieldDefinitions.nodes[0];

    if (existing) {
      if (existing.type.name === def.type) {
        console.log(`exists   ${label(def)}`);
      } else {
        conflicts++;
        console.log(`CONFLICT ${label(def)}: the store already has it as ${existing.type.name}. Left alone.`);
      }
      continue;
    }

    if (!APPLY) {
      console.log(`missing  ${label(def)} (would create)`);
      continue;
    }

    if (sizeGuide) {
      if (!sizeGuideId) throw new Error('size_guide metaobject definition is missing');
      def.validations = [{ name: 'metaobject_definition_id', value: sizeGuideId }];
    }

    const result = (await admin(CREATE_METAFIELD, { definition: def })).metafieldDefinitionCreate;
    checkUserErrors(result, label(def));
    console.log(`created  ${label(def)}`);
  }

  if (!APPLY) console.log('\nDry run only. Re-run with --apply to create the missing definitions.');
  if (conflicts) {
    console.log(`\n${conflicts} conflict(s): fix those in Shopify admin > Settings > Custom data, then re-run.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
