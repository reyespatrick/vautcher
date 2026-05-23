# Vautcher CLI tools

## `extract-restaurant.js`

Pulls a restaurant's identity + content from its public website
into a JSON payload that the restowner Restaurant config editor can
import.

### Install

```
cd scripts && npm install
```

### Use

```
# Output to stdout
node extract-restaurant.js https://www.restaurant-pizzeria-la-gioconda.ch/

# Save to a file
node extract-restaurant.js https://example.com --out bella-vista.json
```

### What it extracts

In order of preference:
1. **JSON-LD** — schema.org `Restaurant` / `LocalBusiness` /
   `FoodEstablishment`: name, address, telephone, email, hours,
   logo, description.
2. **OpenGraph** — `og:title`, `og:description`, `og:image`,
   `og:site_name`.
3. **Heuristics** — phone numbers (regex) and address patterns when
   structured data is absent.

### Apply the result

Open restowner as root → Admin → "Configurer" on the target
restaurant → expand **"Importer JSON"** → paste the payload →
*Importer*. Review the populated form, fix anything off, save.
Then `bash deploy-tenant.sh <slug>` builds and publishes that
tenant to `<slug>.pages.dev`.
