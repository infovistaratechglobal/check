/**
 * Crypto Utilities using Native Web Crypto API
 * Handles AES-GCM symmetric encryption (for secret message & private key)
 * and RSA-OAEP asymmetric encryption (for visitor location logs)
 */

// Helper to convert string to ArrayBuffer
function stringToBuffer(str) {
    return new TextEncoder().encode(str);
}

// Helper to convert ArrayBuffer to string
function bufferToString(buf) {
    return new TextDecoder().decode(buf);
}

// Helper to convert ArrayBuffer to Base64
function bufferToBase64(buf) {
    const binstr = Array.from(new Uint8Array(buf), ch => String.fromCharCode(ch)).join('');
    return btoa(binstr);
}

// Helper to convert Base64 to ArrayBuffer
function base64ToBuffer(base64) {
    const binstr = atob(base64);
    const buf = new Uint8Array(binstr.length);
    for (let i = 0; i < binstr.length; i++) {
        buf[i] = binstr.charCodeAt(i);
    }
    return buf.buffer;
}

// Derive a CryptoKey from a password string using PBKDF2
async function deriveAESKey(password, saltBuffer) {
    const baseKey = await window.crypto.subtle.importKey(
        "raw",
        stringToBuffer(password),
        "PBKDF2",
        false,
        ["deriveKey"]
    );

    return window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: saltBuffer,
            iterations: 100000,
            hash: "SHA-256"
        },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

/**
 * Encrypt plain text using AES-GCM
 * @param {string} plaintext 
 * @param {string} password 
 * @returns {Promise<string>} JSON string of encrypted data containing iv, salt, and ciphertext in base64
 */
async function encryptAES(plaintext, password) {
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveAESKey(password, salt);
    
    const ciphertext = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        stringToBuffer(plaintext)
    );

    return JSON.stringify({
        salt: bufferToBase64(salt),
        iv: bufferToBase64(iv),
        ciphertext: bufferToBase64(ciphertext)
    });
}

/**
 * Decrypt ciphertext using AES-GCM
 * @param {string} encryptedJsonStr JSON string containing salt, iv, and ciphertext
 * @param {string} password 
 * @returns {Promise<string>} Decrypted plaintext
 */
async function decryptAES(encryptedJsonStr, password) {
    const { salt, iv, ciphertext } = JSON.parse(encryptedJsonStr);
    const saltBuf = base64ToBuffer(salt);
    const ivBuf = base64ToBuffer(iv);
    const ciphertextBuf = base64ToBuffer(ciphertext);

    const key = await deriveAESKey(password, saltBuf);
    
    const decryptedBuf = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: ivBuf },
        key,
        ciphertextBuf
    );

    return bufferToString(decryptedBuf);
}

/**
 * Generate an RSA-OAEP Key Pair for visitor log encryption
 * @returns {Promise<{publicKeyJwk: Object, privateKeyJwk: Object}>}
 */
async function generateRSAKeyPair() {
    const keyPair = await window.crypto.subtle.generateKey(
        {
            name: "RSA-OAEP",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256"
        },
        true, // exportable
        ["encrypt", "decrypt"]
    );

    const publicKeyJwk = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const privateKeyJwk = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);

    return { publicKeyJwk, privateKeyJwk };
}

/**
 * Encrypt plaintext using Hybrid Encryption (AES-GCM + RSA-OAEP wrapping)
 * Solves key size limitations for larger payload objects.
 * @param {string} plaintext 
 * @param {Object} publicKeyJwk 
 * @returns {Promise<string>} Base64 encoded JSON package of hybrid encrypted payload
 */
async function encryptRSA(plaintext, publicKeyJwk) {
    // 1. Generate temporary symmetric key
    const aesKey = await window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );

    // 2. Encrypt plaintext payload with AES key
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        aesKey,
        stringToBuffer(plaintext)
    );

    // 3. Export raw AES key to wrap it with RSA
    const rawAesKey = await window.crypto.subtle.exportKey("raw", aesKey);

    // 4. Import RSA public key
    const rsaPublicKey = await window.crypto.subtle.importKey(
        "jwk",
        publicKeyJwk,
        { name: "RSA-OAEP", hash: "SHA-256" },
        false,
        ["encrypt"]
    );

    // 5. Encrypt AES key with RSA public key
    const encryptedAesKey = await window.crypto.subtle.encrypt(
        { name: "RSA-OAEP" },
        rsaPublicKey,
        rawAesKey
    );

    // 6. Return serialized package
    const packageData = JSON.stringify({
        key: bufferToBase64(encryptedAesKey),
        iv: bufferToBase64(iv),
        ciphertext: bufferToBase64(ciphertext)
    });

    return btoa(unescape(encodeURIComponent(packageData)));
}

/**
 * Decrypt hybrid-encrypted payload using RSA-OAEP Private Key
 * @param {string} packageBase64 
 * @param {Object} privateKeyJwk 
 * @returns {Promise<string>} Decrypted plaintext
 */
async function decryptRSA(packageBase64, privateKeyJwk) {
    // Decode base64 package
    const packageData = decodeURIComponent(escape(atob(packageBase64)));
    const { key, iv, ciphertext } = JSON.parse(packageData);

    const encryptedKeyBuf = base64ToBuffer(key);
    const ivBuf = base64ToBuffer(iv);
    const ciphertextBuf = base64ToBuffer(ciphertext);

    // 1. Import RSA private key
    const rsaPrivateKey = await window.crypto.subtle.importKey(
        "jwk",
        privateKeyJwk,
        { name: "RSA-OAEP", hash: "SHA-256" },
        false,
        ["decrypt"]
    );

    // 2. Decrypt the symmetric AES key using RSA
    const rawAesKey = await window.crypto.subtle.decrypt(
        { name: "RSA-OAEP" },
        rsaPrivateKey,
        encryptedKeyBuf
    );

    // 3. Import the decrypted AES key
    const aesKey = await window.crypto.subtle.importKey(
        "raw",
        rawAesKey,
        { name: "AES-GCM" },
        false,
        ["decrypt"]
    );

    // 4. Decrypt original plaintext ciphertext
    const decryptedBuf = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: ivBuf },
        aesKey,
        ciphertextBuf
    );

    return bufferToString(decryptedBuf);
}
