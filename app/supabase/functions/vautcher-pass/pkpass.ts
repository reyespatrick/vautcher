// .pkpass building + signing.
//
// A .pkpass is a ZIP of: pass.json, the images, a manifest.json listing
// the SHA-1 of every file, and a `signature` — a detached PKCS#7
// signature of manifest.json made with the Pass Type ID certificate
// (chained to Apple's WWDR G4 intermediate).
import forge from 'npm:node-forge@1.3.1'
import JSZip from 'npm:jszip@3.10.1'

// Uint8Array -> the binary "string" node-forge works with.
function bin(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return s
}

function sha1Hex(bytes: Uint8Array): string {
  const md = forge.md.sha1.create()
  md.update(bin(bytes))
  return md.digest().toHex()
}

export interface PassCert {
  signerCert: forge.pki.Certificate
  privateKey: forge.pki.PrivateKey
  wwdrCert: forge.pki.Certificate
  // PEM forms — reused by the APNs client for mutual-TLS auth.
  certPem: string
  keyPem: string
}

// Parse the .p12 (base64) once at cold start; also keep PEM forms so the
// same identity can authenticate the APNs connection.
export function loadCert(p12Base64: string, password: string, wwdrPem: string): PassCert {
  const der = forge.util.decode64(p12Base64)
  const asn1 = forge.asn1.fromDer(der)
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password)

  const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.[0]
  const keyBag =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] ??
    p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0]

  if (!certBag?.cert || !keyBag?.key) {
    throw new Error('p12 missing certificate or private key — check PASS_CERT_PASSWORD')
  }

  return {
    signerCert: certBag.cert,
    privateKey: keyBag.key,
    wwdrCert: forge.pki.certificateFromPem(wwdrPem),
    certPem: forge.pki.certificateToPem(certBag.cert),
    keyPem: forge.pki.privateKeyToPem(keyBag.key),
  }
}

// Detached PKCS#7 signature of the manifest.
function signManifest(manifest: string, cert: PassCert): Uint8Array {
  const p7 = forge.pkcs7.createSignedData()
  p7.content = forge.util.createBuffer(manifest, 'utf8')
  p7.addCertificate(cert.signerCert)
  p7.addCertificate(cert.wwdrCert)
  p7.addSigner({
    key: cert.privateKey,
    certificate: cert.signerCert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date().toString() },
    ],
  })
  p7.sign({ detached: true })
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes()
  return Uint8Array.from(der, (c) => c.charCodeAt(0))
}

// Build a signed .pkpass from pass.json plus the (filename -> bytes) images.
export async function buildPkpass(
  passJson: Record<string, unknown>,
  images: Record<string, Uint8Array>,
  cert: PassCert,
): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {
    'pass.json': new TextEncoder().encode(JSON.stringify(passJson)),
    ...images,
  }

  // manifest.json — SHA-1 of every payload file.
  const manifest: Record<string, string> = {}
  for (const [name, bytes] of Object.entries(files)) manifest[name] = sha1Hex(bytes)
  const manifestStr = JSON.stringify(manifest)

  const zip = new JSZip()
  for (const [name, bytes] of Object.entries(files)) zip.file(name, bytes)
  zip.file('manifest.json', manifestStr)
  zip.file('signature', signManifest(manifestStr, cert))

  return await zip.generateAsync({ type: 'uint8array' })
}
