// CipherCast Application State & Logic

let dbRef = null;
let currentConfig = {
    useFirebase: true,
    firebase: {
        apiKey: "AIzaSyCtVJSDh16CfSS9OpIqGx_YmZIG6U3tfQM",
        authDomain: "check-da612.firebaseapp.com",
        databaseURL: "https://check-da612-default-rtdb.firebaseio.com",
        projectId: "check-da612",
        storageBucket: "check-da612.firebasestorage.app",
        messagingSenderId: "133055481236",
        appId: "1:133055481236:web:160afb9a8a1c63bd07fb81"
    }
};

let activeBroadcast = null;
let adminSession = {
    authenticated: false,
    password: "",
    privateKey: null
};

let map = null;
let mapMarkers = [];

// DOM Elements
const views = {
    visitor: document.getElementById('view-visitor'),
    adminLogin: document.getElementById('view-admin-login'),
    adminPanel: document.getElementById('view-admin-panel')
};

const toggleViewBtn = document.getElementById('btn-toggle-view');
const toggleViewText = document.getElementById('toggle-view-text');

// Init application on load
window.addEventListener('DOMContentLoaded', async () => {
    loadSettings();
    initDatabase();
    setupEventListeners();
    
    // Check if URL query contains 'admin' to reveal admin controls
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('admin')) {
        document.querySelector('header').classList.remove('hidden');
    } else {
        document.querySelector('header').classList.add('hidden');
    }

    await checkAndLoadBroadcast();
    initMap();
});

// Load configuration from local storage
function loadSettings() {
    const saved = localStorage.getItem('cc_db_config');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            // Only override default settings if the saved config is valid and has an active API key
            if (parsed && parsed.firebase && parsed.firebase.apiKey) {
                currentConfig = parsed;
            }
        } catch (e) {
            console.error("Error parsing settings", e);
        }
    }
    
    // Apply UI state for config
    document.getElementById('db-use-firebase').checked = currentConfig.useFirebase;
    if (currentConfig.useFirebase) {
        document.getElementById('firebase-config-fields').classList.remove('hidden');
    }
    
    // Populate inputs
    const fb = currentConfig.firebase || {};
    document.getElementById('fb-api-key').value = fb.apiKey || '';
    document.getElementById('fb-db-url').value = fb.databaseURL || '';
    document.getElementById('fb-project-id').value = fb.projectId || '';
    document.getElementById('fb-app-id').value = fb.appId || '';
}

// Initialize Database connection (Firebase or LocalStorage fallback)
function initDatabase() {
    if (currentConfig.useFirebase && currentConfig.firebase.databaseURL) {
        try {
            // Check if already initialized to prevent duplicate app errors
            if (firebase.apps.length === 0) {
                firebase.initializeApp(currentConfig.firebase);
            }
            dbRef = firebase.database().ref();
            console.log("Firebase initialized successfully.");
        } catch (error) {
            console.error("Firebase init failed, falling back to LocalStorage:", error);
            dbRef = null;
        }
    } else {
        dbRef = null;
        console.log("Using LocalStorage fallback database.");
    }
}

// Setup Maps
function initMap() {
    try {
        // Default coordinates: 0, 0 (world view)
        map = L.map('map').setView([20, 0], 2);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(map);
    } catch (e) {
        console.error("Error initializing map", e);
    }
}

// Setup Event Listeners
function setupEventListeners() {
    // View toggling
    toggleViewBtn.addEventListener('click', () => {
        if (views.adminPanel.classList.contains('active')) {
            switchView('visitor');
        } else if (adminSession.authenticated) {
            switchView('admin-panel');
        } else {
            switchView('admin-login');
        }
    });

    // Admin Authentication
    document.getElementById('btn-admin-auth').addEventListener('click', handleAdminLogin);
    document.getElementById('admin-login-password').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleAdminLogin();
    });
    document.getElementById('btn-admin-logout').addEventListener('click', handleAdminLogout);

    // Visitor Decrypt
    document.getElementById('btn-decrypt').addEventListener('click', handleVisitorDecrypt);
    document.getElementById('visitor-answer').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleVisitorDecrypt();
    });

    // Admin Setup Broadcast
    document.getElementById('btn-save-broadcast').addEventListener('click', handleSaveBroadcast);

    // Database Settings saving
    document.getElementById('db-use-firebase').addEventListener('change', (e) => {
        const fields = document.getElementById('firebase-config-fields');
        if (e.target.checked) {
            fields.classList.remove('hidden');
        } else {
            fields.classList.add('hidden');
        }
    });

    document.getElementById('btn-save-db').addEventListener('click', handleSaveDBSettings);

    // Admin Dashboard tabs switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            const targetTab = btn.getAttribute('data-tab');
            btn.classList.add('active');
            document.getElementById(targetTab).classList.add('active');
            
            // Relayout map if tab-logs is active to avoid rendering bugs
            if (targetTab === 'tab-logs' && map) {
                setTimeout(() => {
                    map.invalidateSize();
                }, 100);
            }
        });
    });
}

// Helper to switch main active view card
function switchView(target) {
    Object.keys(views).forEach(key => views[key].classList.remove('active'));
    
    if (target === 'visitor') {
        views.visitor.classList.add('active');
        toggleViewBtn.className = "btn btn-secondary";
        toggleViewBtn.innerHTML = '<i class="fa-solid fa-lock"></i> <span>Admin Panel</span>';
        checkAndLoadBroadcast();
    } else if (target === 'admin-login') {
        views.adminLogin.classList.add('active');
        toggleViewBtn.className = "btn btn-secondary";
        toggleViewBtn.innerHTML = '<i class="fa-solid fa-house"></i> <span>Visitor View</span>';
        document.getElementById('admin-login-password').focus();
    } else if (target === 'admin-panel') {
        views.adminPanel.classList.add('active');
        toggleViewBtn.className = "btn btn-primary success-glow";
        toggleViewBtn.innerHTML = '<i class="fa-solid fa-house"></i> <span>Visitor View</span>';
        loadAdminDashboard();
    }
}

// Database helper functions
async function writeData(path, data) {
    if (dbRef) {
        await dbRef.child(path).set(data);
    } else {
        localStorage.setItem(`cc_db_${path.replace(/\//g, '_')}`, JSON.stringify(data));
    }
}

async function readData(path) {
    if (dbRef) {
        const snapshot = await dbRef.child(path).once('value');
        return snapshot.val();
    } else {
        const data = localStorage.getItem(`cc_db_${path.replace(/\//g, '_')}`);
        return data ? JSON.parse(data) : null;
    }
}

async function pushDataList(path, data) {
    if (dbRef) {
        await dbRef.child(path).push(data);
    } else {
        const currentList = await readData(path) || [];
        currentList.push(data);
        await writeData(path, currentList);
    }
}

// Check and load active broadcast details for visitor
async function checkAndLoadBroadcast() {
    const errorDiv = document.getElementById('visitor-error');
    errorDiv.classList.add('hidden');
    
    try {
        const broadcast = await readData('broadcast');
        activeBroadcast = broadcast;

        if (!broadcast || !broadcast.question) {
            document.getElementById('setup-missing-message').classList.remove('hidden');
            document.getElementById('visitor-form-container').classList.add('hidden');
        } else {
            document.getElementById('setup-missing-message').classList.add('hidden');
            document.getElementById('visitor-form-container').classList.remove('hidden');
            document.getElementById('visitor-question').innerText = broadcast.question;
            
            // Reset fields
            document.getElementById('visitor-answer').value = '';
            document.getElementById('decrypted-message-box').classList.add('hidden');
            document.getElementById('decrypted-text').innerText = '';
        }
    } catch (err) {
        console.error(err);
        errorDiv.innerText = "Error loading broadcast details. Check Connection Settings.";
        errorDiv.classList.remove('hidden');
    }
}

// Visitor decrypt and telemetry gather
async function handleVisitorDecrypt() {
    const answerInput = document.getElementById('visitor-answer').value.trim();
    const errorDiv = document.getElementById('visitor-error');
    const decryptBtn = document.getElementById('btn-decrypt');
    errorDiv.classList.add('hidden');

    if (!answerInput) {
        errorDiv.innerText = "Please enter an answer.";
        errorDiv.classList.remove('hidden');
        return;
    }

    if (!activeBroadcast || !activeBroadcast.encryptedMessage) {
        errorDiv.innerText = "No active broadcast to decrypt.";
        errorDiv.classList.remove('hidden');
        return;
    }

    decryptBtn.disabled = true;
    decryptBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...';

    // Derive symmetric key from visitor's answer (case insensitive match by lowercase)
    const normalizedAnswer = answerInput.toLowerCase();

    try {
        const decryptedText = await decryptAES(activeBroadcast.encryptedMessage, normalizedAnswer);
        
        // Check for specific payload verification header
        if (!decryptedText.startsWith("CIPHERCAST::")) {
            throw new Error("Incorrect Decryption Outcome");
        }

        const realSecretMessage = decryptedText.substring("CIPHERCAST::".length);
        
        // Success
        document.getElementById('decrypted-text').innerText = realSecretMessage;
        document.getElementById('decrypted-message-box').classList.remove('hidden');
        document.getElementById('visitor-form-container').classList.add('hidden');

        // Log visitor metrics securely
        await logVisitorPresence(answerInput, true);

    } catch (err) {
        console.warn("Decryption failed:", err);
        errorDiv.innerText = "Incorrect answer. Message decryption failed.";
        errorDiv.classList.remove('hidden');
        
        // Log failed attempt too (anonymous metadata)
        await logVisitorPresence(answerInput, false);
    } finally {
        decryptBtn.disabled = false;
        decryptBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit';
    }
}

// Fetch visitor telemetry & log it encrypted with RSA public key
async function logVisitorPresence(enteredAnswer, isSuccess) {
    const statusText = document.getElementById('location-sharing-status');
    if (statusText) {
        statusText.classList.remove('hidden');
        statusText.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Registering visitor presence...';
    }

    let visitorData = {
        timestamp: new Date().toISOString(),
        success: isSuccess,
        answerAttempt: enteredAnswer,
        ip: "Unknown",
        isp: "Unknown",
        country: "Unknown",
        city: "Unknown",
        lat: null,
        lon: null,
        accuracy: null
    };

    // 1. Get IP & location details via public API
    try {
        const ipResponse = await fetch('https://ipapi.co/json/');
        if (ipResponse.ok) {
            const ipData = await ipResponse.json();
            visitorData.ip = ipData.ip || "Unknown";
            visitorData.isp = ipData.org || "Unknown";
            visitorData.country = ipData.country_name || "Unknown";
            visitorData.city = ipData.city || "Unknown";
            visitorData.lat = ipData.latitude;
            visitorData.lon = ipData.longitude;
        }
    } catch (e) {
        console.warn("IP geolocation failed", e);
    }

    // 2. Request fine-grained browser location
    if (navigator.geolocation) {
        try {
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    timeout: 8000,
                    enableHighAccuracy: true
                });
            });
            visitorData.lat = position.coords.latitude;
            visitorData.lon = position.coords.longitude;
            visitorData.accuracy = position.coords.accuracy;
        } catch (e) {
            console.warn("Fine location access denied or timed out", e.message);
        }
    }

    // 3. Encrypt data with Broadcast public key
    try {
        if (activeBroadcast && activeBroadcast.publicKey) {
            const dataString = JSON.stringify(visitorData);
            const encryptedLogStr = await encryptRSA(dataString, activeBroadcast.publicKey);
            
            // Push encrypted log string to db
            await pushDataList('logs', encryptedLogStr);
            
            if (statusText) {
                statusText.innerHTML = '<i class="fa-solid fa-circle-check text-success"></i> <span style="color:var(--accent-green)">Presence logged securely!</span>';
            }
        }
    } catch (err) {
        console.error("Failed to write visitor logs:", err);
        if (statusText) {
            statusText.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Failed to submit visitor telemetry: ${err.message}`;
        }
    }
}

// Admin login logic
async function handleAdminLogin() {
    const passwordInput = document.getElementById('admin-login-password').value;
    const errorDiv = document.getElementById('admin-login-error');
    errorDiv.classList.add('hidden');

    if (!passwordInput) {
        errorDiv.innerText = "Please enter admin password.";
        errorDiv.classList.remove('hidden');
        return;
    }

    try {
        const broadcast = await readData('broadcast');
        
        if (!broadcast || !broadcast.encryptedPrivateKey) {
            // First time setup: require the default password 'Amanrockzz@1'
            if (passwordInput !== 'Amanrockzz@1') {
                errorDiv.innerText = "Invalid password. First-time setup password is 'Amanrockzz@1'.";
                errorDiv.classList.remove('hidden');
                return;
            }
            adminSession.authenticated = true;
            adminSession.password = passwordInput;
            adminSession.privateKey = null; // will be generated on setup
            switchView('admin-panel');
            return;
        }

        // Try decrypting private key with entered admin password
        const decryptedKeyStr = await decryptAES(broadcast.encryptedPrivateKey, passwordInput);
        const privateKeyJwk = JSON.parse(decryptedKeyStr);

        adminSession.authenticated = true;
        adminSession.password = passwordInput;
        adminSession.privateKey = privateKeyJwk;

        switchView('admin-panel');
    } catch (err) {
        console.error(err);
        errorDiv.innerText = "Invalid password. Access denied.";
        errorDiv.classList.remove('hidden');
    }
}

function handleAdminLogout() {
    adminSession.authenticated = false;
    adminSession.password = "";
    adminSession.privateKey = null;
    document.getElementById('admin-login-password').value = "";
    switchView('visitor');
}

// Deploy new broadcast properties from Admin panel
async function handleSaveBroadcast() {
    const qtn = document.getElementById('setup-question').value.trim();
    const ans = document.getElementById('setup-answer').value.trim();
    const msg = document.getElementById('setup-message').value.trim();
    const newAdminPass = document.getElementById('setup-admin-password').value;
    
    const statusMsg = document.getElementById('broadcast-status-msg');
    const saveBtn = document.getElementById('btn-save-broadcast');
    
    statusMsg.classList.add('hidden');
    
    if (!qtn || !ans || !msg) {
        alert("Please fill all broadcast configuration fields.");
        return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating Keys & Deploying...';

    try {
        // Generate new RSA Keypair for telemetry encryption
        const { publicKeyJwk, privateKeyJwk } = await generateRSAKeyPair();
        
        const finalAdminPass = newAdminPass || adminSession.password;
        
        // Encrypt private key with the admin password
        const encryptedPrivateKey = await encryptAES(JSON.stringify(privateKeyJwk), finalAdminPass);
        
        // Encrypt the secret message with the visitor security answer (prefixed)
        const plaintextMessage = `CIPHERCAST::${msg}`;
        const encryptedMessage = await encryptAES(plaintextMessage, ans.toLowerCase());

        // Update database
        await writeData('broadcast', {
            question: qtn,
            encryptedMessage: encryptedMessage,
            encryptedPrivateKey: encryptedPrivateKey,
            publicKey: publicKeyJwk
        });

        // Update active session values
        adminSession.password = finalAdminPass;
        adminSession.privateKey = privateKeyJwk;
        document.getElementById('setup-admin-password').value = ''; // Reset password field

        statusMsg.innerText = "Broadcast deployed and secured successfully!";
        statusMsg.classList.remove('hidden');
        
        // Refresh dashboard items
        loadAdminDashboard();
    } catch (err) {
        console.error(err);
        alert("Error saving broadcast options: " + err.message);
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Deploy Broadcast';
    }
}

// Load logs and metrics into Admin dashboard
async function loadAdminDashboard() {
    const listBody = document.getElementById('logs-list');
    listBody.innerHTML = '<tr><td colspan="6" class="text-center"><i class="fa-solid fa-spinner fa-spin"></i> Fetching & decrypting logs...</td></tr>';
    
    // Clear old map markers
    mapMarkers.forEach(marker => map.removeLayer(marker));
    mapMarkers = [];

    try {
        const broadcast = await readData('broadcast');
        
        if (broadcast && broadcast.question) {
            document.getElementById('setup-question').value = broadcast.question;
        }

        const logs = await readData('logs');
        
        if (!logs || (Array.isArray(logs) && logs.length === 0) || Object.keys(logs).length === 0) {
            listBody.innerHTML = '<tr><td colspan="6" class="text-center font-muted">No telemetry received yet.</td></tr>';
            document.getElementById('visitor-count').innerText = "0";
            return;
        }

        // Convert list/dictionary from DB
        const logsArray = Array.isArray(logs) ? logs : Object.values(logs);
        document.getElementById('visitor-count').innerText = logsArray.length;

        listBody.innerHTML = '';
        let mapPoints = [];

        // Decrypt each log entry
        for (let i = logsArray.length - 1; i >= 0; i--) {
            const encryptedLogStr = logsArray[i];
            
            try {
                if (!adminSession.privateKey) {
                    throw new Error("Private key missing in admin session");
                }

                const decryptedLog = await decryptRSA(encryptedLogStr, adminSession.privateKey);
                const logData = JSON.parse(decryptedLog);
                
                // Add marker to map if coordinates exist
                if (logData.lat && logData.lon) {
                    mapPoints.push(logData);
                }

                const tr = document.createElement('tr');
                
                const timeStr = new Date(logData.timestamp).toLocaleString();
                const successBadge = logData.success 
                    ? `<span style="color:var(--accent-green);font-weight:600;"><i class="fa-solid fa-circle-check"></i> Decrypted</span>` 
                    : `<span style="color:var(--accent-red);font-weight:600;"><i class="fa-solid fa-circle-xmark"></i> Failed</span>`;

                tr.innerHTML = `
                    <td>${timeStr}</td>
                    <td>${successBadge}</td>
                    <td>
                        <strong>${logData.ip}</strong><br>
                        <span class="font-muted" style="font-size:0.75rem">${logData.isp}</span>
                    </td>
                    <td>${logData.city}, ${logData.country}</td>
                    <td>
                        ${logData.lat ? `${logData.lat.toFixed(4)}, ${logData.lon.toFixed(4)}` : '<span class="font-muted">Unavailable</span>'}<br>
                        <span class="font-muted" style="font-size:0.75rem">${logData.accuracy ? `Acc: ~${Math.round(logData.accuracy)}m` : ''}</span>
                    </td>
                    <td><code>${escapeHTML(logData.answerAttempt)}</code></td>
                `;
                listBody.appendChild(tr);

            } catch (err) {
                console.error("Error decrypting visitor log:", err);
                const tr = document.createElement('tr');
                tr.innerHTML = `<td colspan="6" class="text-center font-muted"><i class="fa-solid fa-triangle-exclamation text-danger"></i> Failed to decrypt log entry (Corrupt or older key)</td>`;
                listBody.appendChild(tr);
            }
        }

        // Render Map Markers & fit bounds
        if (mapPoints.length > 0 && map) {
            const markerGroup = [];
            mapPoints.forEach(pt => {
                const badgeColor = pt.success ? 'green' : 'red';
                // Leaflet default pin with custom popup
                const marker = L.marker([pt.lat, pt.lon]).addTo(map);
                marker.bindPopup(`
                    <div style="font-family:var(--font-body);color:black;">
                        <strong>Status:</strong> ${pt.success ? 'Decrypted Successfully' : 'Failed Attempt'}<br>
                        <strong>IP:</strong> ${pt.ip}<br>
                        <strong>Loc:</strong> ${pt.city}, ${pt.country}<br>
                        <strong>Time:</strong> ${new Date(pt.timestamp).toLocaleTimeString()}
                    </div>
                `);
                mapMarkers.push(marker);
                markerGroup.push([pt.lat, pt.lon]);
            });

            if (markerGroup.length > 0) {
                map.fitBounds(markerGroup, { padding: [50, 50] });
            }
        }

    } catch (error) {
        console.error(error);
        listBody.innerHTML = '<tr><td colspan="6" class="text-center font-muted">Error reading telemetry details.</td></tr>';
    }
}

// Escape helper to prevent XSS in admin telemetry logs table
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

// Database Configuration Form Handling
async function handleSaveDBSettings() {
    const useFirebase = document.getElementById('db-use-firebase').checked;
    const apiKey = document.getElementById('fb-api-key').value.trim();
    const databaseURL = document.getElementById('fb-db-url').value.trim();
    const projectId = document.getElementById('fb-project-id').value.trim();
    const appId = document.getElementById('fb-app-id').value.trim();

    const statusMsg = document.getElementById('db-status-msg');
    statusMsg.classList.add('hidden');

    if (useFirebase && (!apiKey || !databaseURL || !projectId || !appId)) {
        alert("Please supply all required Firebase configuration parameters.");
        return;
    }

    currentConfig.useFirebase = useFirebase;
    currentConfig.firebase = {
        apiKey,
        databaseURL,
        projectId,
        appId,
        authDomain: `${projectId}.firebaseapp.com`,
        storageBucket: `${projectId}.appspot.com`
    };

    localStorage.setItem('cc_db_config', JSON.stringify(currentConfig));

    statusMsg.innerText = "Settings updated successfully! Reloading connection...";
    statusMsg.classList.remove('hidden');

    // Reinitialize DB
    initDatabase();
    
    // Log out admin and return to visitor to verify new connection
    adminSession.authenticated = false;
    adminSession.password = "";
    adminSession.privateKey = null;
    
    setTimeout(() => {
        statusMsg.classList.add('hidden');
        switchView('visitor');
    }, 1500);
}
