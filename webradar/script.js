// Colors
const localColor = "#109856"
const teamColor = "#68a3e5"
const enemyColor = "#ec040b"
const bombColor = "#eda338"
const textColor = "#d1d1d1"

// Settings
let shouldZoom = false;
let rotateMap = true;
let playerCentered = true;

let drawStats = true;
let drawNames = true;
let drawGuns = true;
let drawMoney = true;

let isRequestPending = false;
let frameCounter = 0;
let fpsStartTime = 0;
let currentFps = 0;

let temporarilyDisableRotation = false;
let rotationDisabledUntilRespawn = false;
let lastKnownPositions = {};

let focusedPlayerYaw = 0;
let focusedPlayerName = "YOU";
let focusedPlayerPos = null;
let playerList = {};

// Common
let canvas = null;
let ctx = null;

// radarflow specific
let radarData = null;
let freq = 0;
let image = null;
let map = null;
let mapName = null;
let loaded = false;
let entityData = null;
let update = false;
let localYaw = 0;
let localPlayerPos = null;

/// Radarflow zoom in
let zoomSet = false;
let safetyBound = 50;
let boundingRect = null;

// Weapon IDs
const weaponIdMap = {
    1: "DEAGLE", 2: "DUALIES", 3: "FIVE-SEVEN", 4: "GLOCK", 7: "AK-47",
    8: "AUG", 9: "AWP", 10: "FAMAS", 11: "G3SG1", 13: "GALIL", 14: "M249",
    16: "M4A4", 17: "MAC-10", 19: "P90", 23: "MP5", 24: "UMP", 25: "XM1014",
    26: "BIZON", 27: "MAG-7", 28: "NEGEV", 29: "SAWED-OFF", 30: "TEC-9",
    31: "ZEUS", 32: "P2000", 33: "MP7", 34: "MP9", 35: "NOVA", 36: "P250",
    38: "SCAR-20", 39: "SG 553", 40: "SCOUT", 60: "M4A1-S", 61: "USP-S",
    63: "CZ75", 64: "REVOLVER", 43: "FLASH", 44: "HE", 45: "SMOKE", 46: "MOLOTOV",
    47: "DECOY", 48: "INCENDIARY", 49: "C4", 0: "KNIFE"
};

// Networking
let websocket = null;
const websocketAddr = location.protocol === 'https:'
    ? `wss://${window.location.host}/ws`
    : `ws://${window.location.host}/ws`;

// Util functions
const clamp = (num, min, max) => Math.min(Math.max(num, min), max);
const degreesToRadians = (degrees) => degrees * (Math.PI / 180);

const pingTracker = {
    history: [],
    lastRequestTime: 0,
    maxSamples: 10,

    startRequest: function () {
        this.lastRequestTime = performance.now();
    },

    endRequest: function () {
        if (this.lastRequestTime === 0) return;

        const ping = performance.now() - this.lastRequestTime;
        this.history.push(ping);

        if (this.history.length > this.maxSamples) {
            this.history.shift();
        }

        this.lastRequestTime = 0;
    },

    getAveragePing: function () {
        if (this.history.length === 0) return 0;
        const sum = this.history.reduce((a, b) => a + b, 0);
        return sum / this.history.length;
    }
};

function render() {
    requestAnimationFrame(render);

    const now = performance.now();
    if (!fpsStartTime) fpsStartTime = now;
    frameCounter++;

    if (now - fpsStartTime > 1000) {
        currentFps = Math.round(frameCounter * 1000 / (now - fpsStartTime));
        frameCounter = 0;
        fpsStartTime = now;
    }

    if (!isRequestPending && websocket && websocket.readyState === WebSocket.OPEN) {
        isRequestPending = true;
        pingTracker.startRequest();
        websocket.send("requestInfo");
    }

    renderFrame();
}

function renderFrame() {
    fillCanvas();

    if (entityData && loaded && map && image) {
        processPlayerPositions();

        if (update) {
            updatePlayerDropdown();
            update = false;
        }

        drawImage();

        drawEntities();

        drawBombTimer();
    } else if (!loaded) {
        ctx.font = "40px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = textColor;
        ctx.fillText(websocket ? "Not on server" : "Disconnected", canvas.width / 2, canvas.height / 2);
    }

    if (drawStats) {
        ctx.font = "16px Arial";
        ctx.textAlign = "left";
        ctx.fillStyle = "#00FF00";
        let rotationStatus = "Active";
        if (temporarilyDisableRotation) rotationStatus = "Manually Disabled";
        else if (rotationDisabledUntilRespawn) rotationStatus = "Disabled (Death)";

        ctx.fillText(`${currentFps} FPS | ${freq} Hz | Ping: ${Math.round(pingTracker.getAveragePing())}ms | Rotation: ${rotationStatus}`, 10, 20);
    }
}

function processPlayerPositions() {
    if (!entityData) return;

    localPlayerPos = null;
    focusedPlayerPos = null;
    focusedPlayerYaw = 0;
    let oldPlayerList = { ...playerList };
    playerList = {};

    entityData.forEach(data => {
        if (data.Player) {
            const player = data.Player;

            if (player.playerType === "Local") {
                localYaw = player.yaw;
                localPlayerPos = player.pos;
                playerList["YOU"] = {
                    pos: player.pos,
                    yaw: player.yaw
                };

                lastKnownPositions["YOU"] = player.pos;
            } else {
                playerList[player.playerName] = {
                    pos: player.pos,
                    yaw: player.yaw
                };

                lastKnownPositions[player.playerName] = player.pos;
            }

            if (player.playerName === focusedPlayerName ||
                (focusedPlayerName === "YOU" && player.playerType === "Local")) {
                focusedPlayerPos = player.pos;
                focusedPlayerYaw = player.yaw;

                if (rotationDisabledUntilRespawn) {
                    console.log("[radarflow] Player respawned, re-enabling rotation");
                    rotationDisabledUntilRespawn = false;
                }
            }
        }
    });

    if (focusedPlayerPos === null) {
        if (oldPlayerList[focusedPlayerName] && oldPlayerList[focusedPlayerName].pos) {
            console.log("[radarflow] Focused player disappeared, disabling rotation until respawn");
            rotationDisabledUntilRespawn = true;
        }
    }

    console.log(`[radarflow] Focused player: ${focusedPlayerName}, Position: ${focusedPlayerPos ? 'Found' : 'Not found'}, Rotation disabled: ${temporarilyDisableRotation || rotationDisabledUntilRespawn}`);
}

function drawImage() {
    if (!image || !canvas || !map) return;

    ctx.save();

    const shouldRotate = rotateMap &&
        focusedPlayerPos &&
        !temporarilyDisableRotation &&
        !rotationDisabledUntilRespawn;

    if (shouldRotate) {
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(degreesToRadians(focusedPlayerYaw + 270));
        ctx.translate(-canvas.width / 2, -canvas.height / 2);
    }

    if (playerCentered && focusedPlayerPos) {
        const playerX = (focusedPlayerPos.x - map.pos_x) / map.scale;
        const playerY = (focusedPlayerPos.y - map.pos_y) / -map.scale;

        const zoomLevel = 0.5;
        const viewWidth = image.width * zoomLevel;
        const viewHeight = image.height * zoomLevel;

        ctx.drawImage(
            image,
            playerX - (viewWidth / 2), playerY - (viewHeight / 2), viewWidth, viewHeight,
            0, 0, canvas.width, canvas.height
        );
    } else if (zoomSet && boundingRect?.x != null) {
        ctx.drawImage(
            image,
            boundingRect.x, boundingRect.y, boundingRect.width, boundingRect.height,
            0, 0, canvas.width, canvas.height
        );
    } else {
        ctx.drawImage(
            image,
            0, 0, image.width, image.height,
            0, 0, canvas.width, canvas.height
        );
    }

    ctx.restore();
}

function drawEntities() {
    if (!entityData) return;

    entityData.forEach(entity => {
        if (entity.Bomb) {
            drawBomb(entity.Bomb.pos, entity.Bomb.isPlanted);
        } else if (entity.Player) {
            const player = entity.Player;
            let fillStyle = localColor;

            switch (player.playerType) {
                case "Team": fillStyle = teamColor; break;
                case "Enemy": fillStyle = enemyColor; break;
            }

            drawEntity(
                player.pos,
                fillStyle,
                player.isDormant,
                player.hasBomb,
                player.yaw,
                player.hasAwp,
                player.playerType,
                player.isScoped,
                player.playerName,
                false,
                player.weaponId
            );

            if (!player.isDormant) {
                if (drawNames) {
                    drawPlayerName(
                        player.pos,
                        player.playerName,
                        player.playerType,
                        player.hasAwp,
                        player.hasBomb,
                        player.isScoped
                    );
                }

                if (drawGuns) {
                    drawPlayerWeapon(
                        player.pos,
                        player.playerType,
                        player.weaponId
                    );
                }

                if (player.hasBomb) {
                    drawPlayerBomb(
                        player.pos,
                        player.playerType
                    );
                }

                if (drawMoney && typeof player.money === 'number') {
                    drawPlayerMoney(
                        player.pos,
                        player.playerType,
                        player.money,
                        player.hasBomb
                    );
                }
            }
        }
    });
}

function drawBombTimer() {
    if (!radarData || !radarData.bombPlanted || radarData.bombExploded || radarData.bombDefuseTimeleft < 0) {
        return;
    }

    const maxWidth = 1024 - 128 - 128;
    const timeleft = radarData.bombDefuseTimeleft;

    ctx.fillStyle = "black";
    ctx.fillRect(128, 16, maxWidth, 16);

    if (radarData.bombBeingDefused) {
        ctx.fillStyle = radarData.bombCanDefuse ? teamColor : enemyColor;
    } else {
        ctx.fillStyle = bombColor;
    }

    ctx.fillRect(130, 18, (maxWidth - 2) * (timeleft / 40), 12);

    ctx.font = "24px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = textColor;
    ctx.fillText(`${timeleft.toFixed(1)}s`, 1024 / 2, 28 + 24);

    ctx.strokeStyle = "black";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(128 + (maxWidth * (5 / 40)), 16);
    ctx.lineTo(128 + (maxWidth * (5 / 40)), 32);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(130 + (maxWidth - 2) * (10 / 40), 16);
    ctx.lineTo(130 + (maxWidth - 2) * (10 / 40), 32);
    ctx.stroke();

    if (radarData.bombCanDefuse) {
        ctx.strokeStyle = "green";
        ctx.beginPath();
        ctx.moveTo(130 + (maxWidth - 2) * (radarData.bombDefuseEnd / 40), 16);
        ctx.lineTo(130 + (maxWidth - 2) * (radarData.bombDefuseEnd / 40), 32);
        ctx.stroke();
    }
}

function fillCanvas() {
    ctx.fillStyle = "#0f0f0f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function updatePlayerDropdown() {
    const dropdown = document.getElementById('playerSelect');
    if (!dropdown) return;

    const currentValue = dropdown.value;

    while (dropdown.options.length > 1) {
        dropdown.remove(1);
    }

    for (const playerName in playerList) {
        if (playerName !== "YOU") {
            const option = document.createElement('option');
            option.value = playerName;
            option.textContent = playerName;
            dropdown.appendChild(option);
        }
    }

    if (Object.keys(playerList).includes(currentValue)) {
        dropdown.value = currentValue;
    } else {
        dropdown.value = "local";
        focusedPlayerName = "YOU";
        if (playerList["YOU"]) {
            focusedPlayerPos = playerList["YOU"].pos;
            focusedPlayerYaw = playerList["YOU"].yaw;
        }
    }
}

function changePlayerFocus() {
    const dropdown = document.getElementById('playerSelect');
    focusedPlayerName = dropdown.value === "local" ? "YOU" : dropdown.value;
    rotationDisabledUntilRespawn = false;
    update = true;
}

function mapCoordinates(coordinates) {
    if (!map || !coordinates) {
        return { x: 0, y: 0 };
    }

    const offset_x = (coordinates.x - map.pos_x) / map.scale;
    const offset_y = (coordinates.y - map.pos_y) / -map.scale;

    return { x: offset_x, y: offset_y };
}

function mapAndTransformCoordinates(pos) {
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const imageWidth = image ? image.width : 1;
    const imageHeight = image ? image.height : 1;

    if (!map || !pos) return { pos: { x: 0, y: 0 }, textSize: 12 };

    const offset_x = (pos.x - map.pos_x) / map.scale;
    const offset_y = (pos.y - map.pos_y) / -map.scale;

    let mapPos = { x: offset_x, y: offset_y };
    let textSize = 12;

    if (zoomSet && boundingRect && boundingRect.x != null) {
        const xScale = boundingRect.width / imageWidth;
        const yScale = boundingRect.height / imageHeight;
        mapPos = {
            x: (mapPos.x - boundingRect.x) / xScale,
            y: (mapPos.y - boundingRect.y) / yScale
        };
        textSize = (imageWidth / boundingRect.width) * 12;
    }
    else if (playerCentered && focusedPlayerPos) {
        const zoomLevel = 0.5;
        const viewWidth = imageWidth * zoomLevel;
        const viewHeight = imageHeight * zoomLevel;

        let playerMapPos;
        if (focusedPlayerName === "YOU" && localPlayerPos) {
            const lpx = (localPlayerPos.x - map.pos_x) / map.scale;
            const lpy = (localPlayerPos.y - map.pos_y) / -map.scale;
            playerMapPos = { x: lpx, y: lpy };
        } else if (focusedPlayerPos) {
            const fpx = (focusedPlayerPos.x - map.pos_x) / map.scale;
            const fpy = (focusedPlayerPos.y - map.pos_y) / -map.scale;
            playerMapPos = { x: fpx, y: fpy };
        } else {
            playerMapPos = { x: 0, y: 0 };
        }

        mapPos.x = (mapPos.x - (playerMapPos.x - viewWidth / 2)) * canvasWidth / viewWidth;
        mapPos.y = (mapPos.y - (playerMapPos.y - viewHeight / 2)) * canvasHeight / viewHeight;
    }
    else {
        mapPos.x = mapPos.x * canvasWidth / imageWidth;
        mapPos.y = mapPos.y * canvasHeight / imageHeight;
    }

    const shouldRotate = rotateMap &&
        typeof focusedPlayerYaw === 'number' &&
        !temporarilyDisableRotation &&
        !rotationDisabledUntilRespawn;

    if (shouldRotate) {
        const canvasCenter = { x: canvasWidth / 2, y: canvasHeight / 2 };
        const rotationYaw = focusedPlayerName === "YOU" ? localYaw : focusedPlayerYaw;
        const angle = rotationYaw + 270;

        const radians = angle * (Math.PI / 180);
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);

        const nx = mapPos.x - canvasCenter.x;
        const ny = mapPos.y - canvasCenter.y;

        mapPos.x = nx * cos - ny * sin + canvasCenter.x;
        mapPos.y = nx * sin + ny * cos + canvasCenter.y;
    }

    return { pos: mapPos, textSize: textSize };
}

function drawPlayerName(pos, playerName, playerType, hasAwp, hasBomb, isScoped) {
    if (!map) return;

    const transformed = mapAndTransformCoordinates(pos);
    const mapPos = transformed.pos;
    const textSize = transformed.textSize;

    const textY = mapPos.y + 20;

    let displayName = playerName;
    if (playerType === "Local") {
        displayName = "YOU";
        ctx.fillStyle = localColor;
    } else if (playerType === "Team") {
        ctx.fillStyle = teamColor;
    } else if (playerType === "Enemy") {
        ctx.fillStyle = enemyColor;
    }

    if (isScoped) {
        displayName += " [SCOPED]";
    }

    ctx.font = `${textSize}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    ctx.lineWidth = 2;
    ctx.strokeStyle = "black";
    ctx.strokeText(displayName, mapPos.x, textY);
    ctx.fillText(displayName, mapPos.x, textY);
}

function drawPlayerMoney(pos, playerType, money, hasBomb) {
    if (!map) return;

    const transformed = mapAndTransformCoordinates(pos);
    const mapPos = transformed.pos;
    const textSize = transformed.textSize * 0.8;

    let extraOffset = 0;
    if (drawNames) extraOffset += 15;
    if (drawGuns) extraOffset += 15;
    if (hasBomb) extraOffset += 15;

    let textY = mapPos.y + 20 + extraOffset;

    const formattedMoney = '$' + (money || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

    if (money >= 10000) {
        ctx.fillStyle = "#32CD32";
    } else if (money >= 4500) {
        ctx.fillStyle = "#FFFF00";
    } else {
        ctx.fillStyle = "#FF4500";
    }

    ctx.font = `${textSize}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    ctx.lineWidth = 2;
    ctx.strokeStyle = "black";
    ctx.strokeText(formattedMoney, mapPos.x, textY);
    ctx.fillText(formattedMoney, mapPos.x, textY);
}

function drawPlayerWeapon(pos, playerType, weaponId) {
    if (!map) return;

    const transformed = mapAndTransformCoordinates(pos);
    const mapPos = transformed.pos;
    const textSize = transformed.textSize * 0.8;

    const textY = mapPos.y + (drawNames ? 35 : 20);

    let weaponName = getWeaponName(weaponId);

    if (weaponId === 9) {
        ctx.fillStyle = "orange";
    } else {
        ctx.fillStyle = textColor;
    }

    ctx.font = `${textSize}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    ctx.lineWidth = 2;
    ctx.strokeStyle = "black";
    ctx.strokeText(`[${weaponName}]`, mapPos.x, textY);
    ctx.fillText(`[${weaponName}]`, mapPos.x, textY);
}

function drawPlayerBomb(pos, playerType) {
    if (!map) return;

    const transformed = mapAndTransformCoordinates(pos);
    const mapPos = transformed.pos;
    const textSize = transformed.textSize * 0.8;

    const textY = mapPos.y + (drawNames ? (drawGuns ? 50 : 35) : (drawGuns ? 35 : 20));

    ctx.fillStyle = bombColor;
    ctx.font = `${textSize}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    ctx.lineWidth = 2;
    ctx.strokeStyle = "black";
    ctx.strokeText("[C4]", mapPos.x, textY);
    ctx.fillText("[C4]", mapPos.x, textY);
}

function drawBomb(pos, planted) {
    if (!map) return;

    const transformed = mapAndTransformCoordinates(pos);
    const mapPos = transformed.pos;
    const size = transformed.textSize * 0.7;

    ctx.beginPath();
    ctx.arc(mapPos.x, mapPos.y, size, 0, 2 * Math.PI);
    ctx.fillStyle = bombColor;
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = "black";
    ctx.stroke();

    ctx.font = size * 1.2 + "px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "white";
    ctx.fillText("C4", mapPos.x, mapPos.y);

    ctx.closePath();

    if (planted && ((new Date().getTime() / 1000) % 1) > 0.5) {
        ctx.strokeStyle = enemyColor;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(mapPos.x, mapPos.y, size + 4, 0, 2 * Math.PI);
        ctx.stroke();
    }
}

function drawEntity(pos, fillStyle, dormant, hasBomb, yaw, hasAwp, playerType, isScoped, playerName, isPlanted, weaponId) {
    if (!map) return;

    const transformed = mapAndTransformCoordinates(pos);
    const mapPos = transformed.pos;
    const circleRadius = transformed.textSize * 0.6;
    const distance = circleRadius + 2;
    const radius = distance + 5;
    const arrowWidth = 35;

    const isFocusedPlayer = playerName === focusedPlayerName ||
        (focusedPlayerName === "YOU" && playerType === "Local");

    let adjustedYaw = yaw;

    const shouldAdjustRotation = rotateMap &&
        !temporarilyDisableRotation &&
        !rotationDisabledUntilRespawn;

    if (shouldAdjustRotation) {
        if (isFocusedPlayer) {
            adjustedYaw = 90;
        } else {
            adjustedYaw = (yaw + 180) - focusedPlayerYaw + 270;
        }
    }

    if (dormant) {
        ctx.font = "20px Arial";
        ctx.textAlign = "center";
        ctx.fillStyle = fillStyle;
        ctx.fillText("?", mapPos.x, mapPos.y);
    } else {
        if (isFocusedPlayer) {
            ctx.beginPath();
            ctx.arc(mapPos.x, mapPos.y, circleRadius + 4, 0, 2 * Math.PI);
            ctx.fillStyle = "#FFFFFF";
            ctx.fill();
            ctx.closePath();
        }

        if (hasAwp) {
            ctx.beginPath();
            ctx.arc(mapPos.x, mapPos.y, circleRadius, 0, 2 * Math.PI);
            ctx.fillStyle = "orange";
            ctx.fill();
            circleRadius -= 2;
        }

        // Draw circle
        ctx.beginPath();
        ctx.arc(mapPos.x, mapPos.y, circleRadius, 0, 2 * Math.PI);
        ctx.fillStyle = fillStyle;
        ctx.fill();
        ctx.closePath();

        const arrowHeadX = mapPos.x + radius * Math.cos(adjustedYaw * (Math.PI / 180));
        const arrowHeadY = mapPos.y - radius * Math.sin(adjustedYaw * (Math.PI / 180));

        const arrowCornerX1 = mapPos.x + distance * Math.cos((adjustedYaw - arrowWidth) * (Math.PI / 180));
        const arrowCornerY1 = mapPos.y - distance * Math.sin((adjustedYaw - arrowWidth) * (Math.PI / 180));

        const arrowCornerX2 = mapPos.x + distance * Math.cos((adjustedYaw + arrowWidth) * (Math.PI / 180));
        const arrowCornerY2 = mapPos.y - distance * Math.sin((adjustedYaw + arrowWidth) * (Math.PI / 180));

        const cicleYaw = 90 - adjustedYaw;
        const startAngle = degreesToRadians(cicleYaw - arrowWidth) - Math.PI / 2;
        const endAngle = degreesToRadians(cicleYaw + arrowWidth) - Math.PI / 2;

        // Draw arrow
        ctx.beginPath();
        ctx.arc(mapPos.x, mapPos.y, distance, startAngle, endAngle);
        ctx.lineTo(arrowCornerX1, arrowCornerY1);
        ctx.lineTo(arrowHeadX, arrowHeadY);
        ctx.lineTo(arrowCornerX2, arrowCornerY2);
        ctx.closePath();
        ctx.fillStyle = 'white';
        ctx.fill();

        if (isScoped) {
            const lineOfSightX = arrowHeadX + 1024 * Math.cos(adjustedYaw * (Math.PI / 180));
            const lineOfSightY = arrowHeadY - 1024 * Math.sin(adjustedYaw * (Math.PI / 180));
            ctx.beginPath();
            ctx.moveTo(arrowHeadX, arrowHeadY);
            ctx.lineTo(lineOfSightX, lineOfSightY);

            ctx.strokeStyle = playerType == "Enemy" ? enemyColor : teamColor;
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }
}

function getWeaponName(weaponId) {
    if (weaponIdMap[weaponId]) {
        return weaponIdMap[weaponId];
    }

    if (weaponId >= 500) {
        return "KNIFE";
    }

    return "KNIFE";
}

function loadMap(mapName) {
    if (!mapName) return;

    console.log(`[radarflow] Loading map "${mapName}"`);
    loaded = true;

    // Load JSON data
    const jsonPath = `assets/json/${mapName}.json`;
    fetch(jsonPath)
        .then(response => {
            if (!response.ok) throw new Error(`JSON not found: ${response.status}`);
            return response.json();
        })
        .then(data => {
            console.log("[radarflow] Map data loaded");
            map = data;
            update = true;
        })
        .catch(error => {
            console.error(`[radarflow] Error loading JSON: ${error}`);
        });

    const imagePath = `assets/image/${mapName}_radar_psd.png`;
    const map_img = new Image();

    map_img.onload = () => {
        console.log("[radarflow] Map image loaded");
        image = map_img;
        update = true;
    };

    map_img.onerror = (e) => {
        console.error(`[radarflow] Error loading image: ${e}`);
    };

    map_img.src = imagePath;
}

function unloadMap() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    map = null;
    mapName = null;
    loaded = false;
    update = true;
}

function processData(data) {
    if (!data) return;

    radarData = data;
    freq = data.freq;
    entityData = data.entityData;

    if (data.money_reveal_enabled !== undefined) {
        const checkbox = document.getElementById("moneyReveal");
        if (checkbox) checkbox.checked = data.money_reveal_enabled;
    }

    if (data.ingame === false) {
        if (loaded) unloadMap();
    } else {
        if (!loaded && data.mapName) {
            mapName = data.mapName;
            loadMap(mapName);
        }
    }

    update = true;
}

function decompressData(data) {
    try {
        pingTracker.endRequest();

        if (data[0] === 0x01) {
            try {
                if (typeof pako === 'undefined') {
                    console.error("[radarflow] Pako library not available");
                    return null;
                }

                const decompressed = pako.inflate(data.slice(1));
                const text = new TextDecoder().decode(decompressed);
                return JSON.parse(text);
            } catch (e) {
                console.error("[radarflow] Decompression error:", e);
                return null;
            }
        } else if (data[0] === 0x00) {
            try {
                const text = new TextDecoder().decode(data.slice(1));
                return JSON.parse(text);
            } catch (e) {
                console.error("[radarflow] Parse error:", e);
                return null;
            }
        } else {
            console.error("[radarflow] Unknown data format");
            return null;
        }
    } catch (e) {
        console.error("[radarflow] Data processing error:", e);
        return null;
    }
}

function connect() {
    if (websocket == null) {
        console.log(`[radarflow] Connecting to ${websocketAddr}`);

        let socket = new WebSocket(websocketAddr);

        socket.onopen = () => {
            console.log("[radarflow] Connection established");
            requestAnimationFrame(render);
        };

        socket.onmessage = (event) => {
            isRequestPending = false;

            if (event.data === "error") {
                console.error("[radarflow] Server error");
                return;
            }

            if (event.data instanceof Blob) {
                event.data.arrayBuffer().then(buffer => {
                    const data = new Uint8Array(buffer);
                    const jsonData = decompressData(data);
                    if (jsonData) processData(jsonData);
                }).catch(err => {
                    console.error("[radarflow] Buffer processing error:", err);
                });
            } else if (typeof event.data === 'string') {
                try {
                    const jsonData = JSON.parse(event.data);
                    if (jsonData.action === "toggleMoneyReveal") {
                        document.getElementById("moneyReveal").checked = jsonData.enabled;
                    } else {
                        processData(jsonData);
                    }
                } catch (e) {
                    console.error("[radarflow] JSON parse error:", e);
                }
            }
        };

        socket.onclose = (event) => {
            console.log("[radarflow] Connection closed");
            websocket = null;
            unloadMap();
            setTimeout(connect, 1000);
        };

        socket.onerror = (error) => {
            console.error("[radarflow] WebSocket error:", error);
        };

        websocket = socket;
    }
}

function toggleZoom() {
    shouldZoom = !shouldZoom;
}

function toggleStats() {
    drawStats = !drawStats;
}

function toggleNames() {
    drawNames = !drawNames;
}

function toggleGuns() {
    drawGuns = !drawGuns;
}

function toggleRotate() {
    rotateMap = !rotateMap;
}

function toggleCentered() {
    playerCentered = !playerCentered;
}

function toggleMoneyReveal() {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        console.log("[radarflow] Sending toggleMoneyReveal command");
        websocket.send("toggleMoneyReveal");
    }
}

function toggleDisplayMoney() {
    drawMoney = !drawMoney;
    update = true;
    localStorage.setItem('drawMoney', drawMoney ? 'true' : 'false');
}

function togglePerformanceMode() {
    const performanceMode = document.getElementById('performanceMode').checked;

    if (performanceMode) {
        drawNames = false;
        drawGuns = false;
        drawMoney = false;

        document.getElementById("namesCheck").checked = false;
        document.getElementById("gunsCheck").checked = false;
        document.getElementById("moneyDisplay").checked = false;

        console.log("[radarflow] Performance mode enabled");
    } else {
        drawNames = document.getElementById("namesCheck").checked = true;
        drawGuns = document.getElementById("gunsCheck").checked = true;
        drawMoney = document.getElementById("moneyDisplay").checked = true;

        console.log("[radarflow] Performance mode disabled");
    }
}

addEventListener("DOMContentLoaded", () => {
    const savedDrawMoney = localStorage.getItem('drawMoney');
    drawMoney = savedDrawMoney !== null ? savedDrawMoney === 'true' : true;

    const checkboxes = {
        "zoomCheck": false,
        "statsCheck": true,
        "namesCheck": true,
        "gunsCheck": true,
        "moneyDisplay": drawMoney,
        "moneyReveal": false,
        "rotateCheck": true,
        "centerCheck": true
    };

    Object.entries(checkboxes).forEach(([id, state]) => {
        const checkbox = document.getElementById(id);
        if (checkbox) checkbox.checked = state;
    });

    canvas = document.getElementById('canvas');
    if (canvas) {
        canvas.width = 1024;
        canvas.height = 1024;
        ctx = canvas.getContext('2d');

        connect();
    } else {
        console.error("[radarflow] Canvas element not found");
    }
});