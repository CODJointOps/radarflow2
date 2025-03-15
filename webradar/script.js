// Colors
const localColor = "#109856"
const teamColor = "#68a3e5"
const enemyColor = "#ec040b"
const bombColor = "#eda338"
const textColor = "#d1d1d1"

// Settings
shouldZoom = false
rotateMap = true
playerCentered = true

drawStats = true
drawNames = true
drawGuns = true

// Common
canvas = null
ctx = null

// radarflow specific
radarData = null
freq = 0
image = null
map = null
mapName = null
loaded = false
entityData = null
update = false
localYaw = 0
localPlayerPos = null

/// Radarflow zoom in
zoomSet = false
safetyBound = 50
boundingRect = null

// Weapon IDs
const weaponIdMap = {
    1: "DEAGLE",
    2: "DUALIES",
    3: "FIVE-SEVEN",
    4: "GLOCK",
    7: "AK-47",
    8: "AUG",
    9: "AWP",
    10: "FAMAS",
    11: "G3SG1",
    13: "GALIL",
    14: "M249",
    16: "M4A4",
    17: "MAC-10",
    19: "P90",
    23: "MP5",
    24: "UMP",
    25: "XM1014",
    26: "BIZON",
    27: "MAG-7",
    28: "NEGEV",
    29: "SAWED-OFF",
    30: "TEC-9",
    31: "ZEUS",
    32: "P2000",
    33: "MP7",
    34: "MP9",
    35: "NOVA",
    36: "P250",
    38: "SCAR-20",
    39: "SG 553",
    40: "SCOUT",
    60: "M4A1-S",
    61: "USP-S",
    63: "CZ75",
    64: "REVOLVER",
    43: "FLASH",
    44: "HE",
    45: "SMOKE",
    46: "MOLOTOV",
    47: "DECOY",
    48: "INCENDIARY",
    49: "C4",
    0: "KNIFE"
};

// networking
websocket = null
if (location.protocol == 'https:') {
    websocketAddr = `wss://${window.location.host}/ws`
} else {
    websocketAddr = `ws://${window.location.host}/ws`
}
//websocketAddr = "ws://192.168.0.235:8000/ws"

// Util functions
const clamp = (num, min, max) => Math.min(Math.max(num, min), max);
const degreesToRadians = (degrees) => degrees * (Math.PI / 180);

function mapCoordinates(coordinates) {
    let offset_x = coordinates.x - map.pos_x;
    let offset_y = coordinates.y - map.pos_y;

    offset_x /= map.scale;
    offset_y /= -map.scale;

    return { x: offset_x, y: offset_y };
}

function boundingCoordinates(coordinates, boundingRect) {
    const xScale = boundingRect.width / image.width;
    const yScale = boundingRect.height / image.height;

    const newX = (coordinates.x - boundingRect.x) / xScale;
    const newY = (coordinates.y - boundingRect.y) / yScale;

    return { x: newX, y: newY };
}

function boundingScale(value, boundingRect) {
    const scale = image.width / boundingRect.width;
    return value * scale;
}

function rotatePoint(cx, cy, x, y, angle) {
    const radians = degreesToRadians(angle);
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);

    const nx = x - cx;
    const ny = y - cy;

    const rx = nx * cos - ny * sin;
    const ry = nx * sin + ny * cos;

    return {
        x: rx + cx,
        y: ry + cy
    };
}

function makeBoundingRect(x1, y1, x2, y2, aspectRatio) {
    const topLeftX = x1;
    const topLeftY = y1;
    const bottomRightX = x2;
    const bottomRightY = y2;

    const width = bottomRightX - topLeftX;
    const height = bottomRightY - topLeftY;

    let newWidth, newHeight;
    if (width / height > aspectRatio) {
        // Wider rectangle
        newHeight = width / aspectRatio;
        newWidth = width;
    } else {
        // Taller rectangle
        newWidth = height * aspectRatio;
        newHeight = height;
    }

    const centerX = (topLeftX + bottomRightX) / 2;
    const centerY = (topLeftY + bottomRightY) / 2;

    const rectMinX = centerX - newWidth / 2;
    const rectMaxX = centerX + newWidth / 2;
    const rectMinY = centerY - newHeight / 2;
    const rectMaxY = centerY + newHeight / 2;

    return {
        x: rectMinX,
        y: rectMinY,
        width: rectMaxX - rectMinX,
        height: rectMaxY - rectMinY,
    };
}

function render() {
    if (update) {
        fillCanvas();
        if (loaded) {
            update = false;

            localPlayerPos = null;
            if (entityData != null) {
                entityData.forEach((data) => {
                    if (data.Player !== undefined && data.Player.playerType === "Local") {
                        localYaw = data.Player.yaw;
                        localPlayerPos = data.Player.pos;
                    }
                });
            }

            if (entityData != null && map != null && image != null && shouldZoom && !playerCentered) {
                let minX = Infinity;
                let minY = Infinity;
                let maxX = -Infinity;
                let maxY = -Infinity;

                entityData.forEach((data) => {
                    let mapCords = null;

                    if (data.Bomb !== undefined) {
                        mapCords = mapCoordinates(data.Bomb.pos);
                    } else {
                        mapCords = mapCoordinates(data.Player.pos);
                    }

                    minX = Math.min(minX, mapCords.x);
                    minY = Math.min(minY, mapCords.y);
                    maxX = Math.max(maxX, mapCords.x);
                    maxY = Math.max(maxY, mapCords.y);
                });

                boundingRect = makeBoundingRect(minX - safetyBound, minY - safetyBound, maxX + safetyBound, maxY + safetyBound, image.width / image.height);
                zoomSet = true;
            } else if (zoomSet && !playerCentered) {
                zoomSet = false;
            }

            drawImage();

            if (entityData != null) {
                entityData.forEach((data) => {
                    if (data.Bomb !== undefined) {
                        drawBomb(data.Bomb.pos, data.Bomb.isPlanted);
                    } else {
                        let fillStyle = localColor;

                        switch (data.Player.playerType) {
                            case "Team":
                                fillStyle = teamColor;
                                break;

                            case "Enemy":
                                fillStyle = enemyColor;
                                break;
                        }

                        drawEntity(
                            data.Player.pos,
                            fillStyle,
                            data.Player.isDormant,
                            data.Player.hasBomb,
                            data.Player.yaw,
                            data.Player.hasAwp,
                            data.Player.playerType,
                            data.Player.isScoped,
                            data.Player.playerName,
                            false,
                            data.Player.weaponId
                        );

                        if (drawNames && !data.Player.isDormant) {
                            drawPlayerName(
                                data.Player.pos,
                                data.Player.playerName,
                                data.Player.playerType,
                                data.Player.hasAwp,
                                data.Player.hasBomb,
                                data.Player.isScoped
                            );
                        }

                        if (drawGuns && !data.Player.isDormant) {
                            drawPlayerWeapon(
                                data.Player.pos,
                                data.Player.playerType,
                                data.Player.weaponId
                            );
                        }

                        if (data.Player.hasBomb && !data.Player.isDormant) {
                            drawPlayerBomb(
                                data.Player.pos,
                                data.Player.playerType
                            );
                        }
                    }
                });
            }

            if (radarData != null) {
                if (radarData.bombPlanted && !radarData.bombExploded && radarData.bombDefuseTimeleft >= 0) {
                    let maxWidth = 1024 - 128 - 128;
                    let timeleft = radarData.bombDefuseTimeleft;

                    // Base bar
                    ctx.fillStyle = "black";
                    ctx.fillRect(128, 16, maxWidth, 16);

                    // Bomb timer
                    if (radarData.bombBeingDefused) {
                        if (radarData.bombCanDefuse) {
                            ctx.fillStyle = teamColor;
                        } else {
                            ctx.fillStyle = enemyColor;
                        }
                    } else {
                        ctx.fillStyle = bombColor;
                    }

                    ctx.fillRect(130, 18, (maxWidth - 2) * (timeleft / 40), 12);

                    ctx.font = "24px Arial";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillStyle = textColor;
                    ctx.fillText(`${timeleft.toFixed(1)}s`, 1024 / 2, 28 + 24);

                    // Defuse time lines
                    ctx.strokeStyle = "black";
                    ctx.lineWidth = 2;

                    // Kit defuse
                    ctx.beginPath();
                    ctx.moveTo(128 + (maxWidth * (5 / 40)), 16);
                    ctx.lineTo(128 + (maxWidth * (5 / 40)), 32);
                    ctx.stroke();

                    // Normal defuse
                    ctx.beginPath();
                    ctx.moveTo(130 + (maxWidth - 2) * (10 / 40), 16);
                    ctx.lineTo(130 + (maxWidth - 2) * (10 / 40), 32);
                    ctx.stroke();

                    // Defuse stamp line
                    if (radarData.bombCanDefuse) {
                        ctx.strokeStyle = "green";
                        ctx.beginPath();
                        ctx.moveTo(130 + (maxWidth - 2) * (radarData.bombDefuseEnd / 40), 16);
                        ctx.lineTo(130 + (maxWidth - 2) * (radarData.bombDefuseEnd / 40), 32);
                        ctx.stroke();
                    }
                }
            }
        } else {
            if (websocket != null) {
                ctx.font = "100px Arial";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = textColor;
                ctx.fillText("Not on a server", 1024 / 2, 1024 / 2);
            } else {
                ctx.font = "100px Arial";
                ctx.textAlign = "center";
                ctx.fillStyle = textColor;
                ctx.fillText("Disconnected", 1024 / 2, 1024 / 2);
            }
        }

        if (drawStats) {
            ctx.font = "16px Arial";
            ctx.textAlign = "left";
            ctx.fillStyle = textColor;
            ctx.lineWidth = 2;
            ctx.strokeStyle = "black";
            ctx.strokeText(`${freq} Hz`, 2, 18);
            ctx.fillText(`${freq} Hz`, 2, 18);
        }
    }

    if (websocket != null) {
        websocket.send("requestInfo");
    }
}

function fillCanvas() {
    ctx.fillStyle = "#0f0f0f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawImage() {
    if (image == null || canvas == null)
        return

    ctx.save();

    if (rotateMap) {
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(degreesToRadians(localYaw + 270));
        ctx.translate(-canvas.width / 2, -canvas.height / 2);
    }

    if (playerCentered && localPlayerPos) {
        const playerMapPos = mapCoordinates(localPlayerPos);
        const zoomLevel = 0.5;
        const viewWidth = image.width * zoomLevel;
        const viewHeight = image.height * zoomLevel;
        const viewX = playerMapPos.x - (viewWidth / 2);
        const viewY = playerMapPos.y - (viewHeight / 2);

        ctx.drawImage(
            image,
            viewX, viewY, viewWidth, viewHeight,
            0, 0, canvas.width, canvas.height
        );
    } else if (zoomSet != false && boundingRect.x != null) {
        ctx.drawImage(image, boundingRect.x, boundingRect.y, boundingRect.width, boundingRect.height, 0, 0, canvas.width, canvas.height)
    } else {
        ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, canvas.width, canvas.height)
    }

    ctx.restore();
}

function drawPlayerName(pos, playerName, playerType, hasAwp, hasBomb, isScoped) {
    if (!map) return;

    let mapPos = mapCoordinates(pos);
    let textSize;

    if (zoomSet) {
        mapPos = boundingCoordinates(mapPos, boundingRect);
        textSize = boundingScale(12, boundingRect);
    } else if (playerCentered && localPlayerPos) {
        const playerMapPos = mapCoordinates(localPlayerPos);
        const zoomLevel = 0.5;
        const viewWidth = image.width * zoomLevel;
        const viewHeight = image.height * zoomLevel;

        mapPos.x = (mapPos.x - (playerMapPos.x - viewWidth / 2)) * canvas.width / viewWidth;
        mapPos.y = (mapPos.y - (playerMapPos.y - viewHeight / 2)) * canvas.height / viewHeight;
        textSize = 12;
    } else {
        mapPos.x = mapPos.x * canvas.width / image.width;
        mapPos.y = mapPos.y * canvas.height / image.height;
        textSize = 12;
    }

    if (rotateMap) {
        const canvasCenter = { x: canvas.width / 2, y: canvas.height / 2 };
        mapPos = rotatePoint(canvasCenter.x, canvasCenter.y, mapPos.x, mapPos.y, localYaw + 270);
    }

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

function drawPlayerWeapon(pos, playerType, weaponId) {
    if (!map) return;

    let mapPos = mapCoordinates(pos);
    let textSize;

    if (zoomSet) {
        mapPos = boundingCoordinates(mapPos, boundingRect);
        textSize = boundingScale(10, boundingRect);
    } else if (playerCentered && localPlayerPos) {
        const playerMapPos = mapCoordinates(localPlayerPos);
        const zoomLevel = 0.5;
        const viewWidth = image.width * zoomLevel;
        const viewHeight = image.height * zoomLevel;

        mapPos.x = (mapPos.x - (playerMapPos.x - viewWidth / 2)) * canvas.width / viewWidth;
        mapPos.y = (mapPos.y - (playerMapPos.y - viewHeight / 2)) * canvas.height / viewHeight;
        textSize = 10;
    } else {
        mapPos.x = mapPos.x * canvas.width / image.width;
        mapPos.y = mapPos.y * canvas.height / image.height;
        textSize = 10;
    }

    if (rotateMap) {
        const canvasCenter = { x: canvas.width / 2, y: canvas.height / 2 };
        mapPos = rotatePoint(canvasCenter.x, canvasCenter.y, mapPos.x, mapPos.y, localYaw + 270);
    }

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

    let mapPos = mapCoordinates(pos);
    let textSize;

    if (zoomSet) {
        mapPos = boundingCoordinates(mapPos, boundingRect);
        textSize = boundingScale(10, boundingRect);
    } else if (playerCentered && localPlayerPos) {
        const playerMapPos = mapCoordinates(localPlayerPos);
        const zoomLevel = 0.5;
        const viewWidth = image.width * zoomLevel;
        const viewHeight = image.height * zoomLevel;

        mapPos.x = (mapPos.x - (playerMapPos.x - viewWidth / 2)) * canvas.width / viewWidth;
        mapPos.y = (mapPos.y - (playerMapPos.y - viewHeight / 2)) * canvas.height / viewHeight;
        textSize = 10;
    } else {
        mapPos.x = mapPos.x * canvas.width / image.width;
        mapPos.y = mapPos.y * canvas.height / image.height;
        textSize = 10;
    }

    if (rotateMap) {
        const canvasCenter = { x: canvas.width / 2, y: canvas.height / 2 };
        mapPos = rotatePoint(canvasCenter.x, canvasCenter.y, mapPos.x, mapPos.y, localYaw + 270);
    }

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
    if (map == null)
        return

    let mapPos = mapCoordinates(pos);
    let size;

    if (zoomSet) {
        mapPos = boundingCoordinates(mapPos, boundingRect);
        size = boundingScale(8, boundingRect);
    } else if (playerCentered && localPlayerPos) {
        const playerMapPos = mapCoordinates(localPlayerPos);
        const zoomLevel = 0.5;
        const viewWidth = image.width * zoomLevel;
        const viewHeight = image.height * zoomLevel;

        mapPos.x = (mapPos.x - (playerMapPos.x - viewWidth / 2)) * canvas.width / viewWidth;
        mapPos.y = (mapPos.y - (playerMapPos.y - viewHeight / 2)) * canvas.height / viewHeight;
        size = 8;
    } else {
        mapPos.x = mapPos.x * canvas.width / image.width;
        mapPos.y = mapPos.y * canvas.height / image.height;
        size = 8;
    }

    if (rotateMap) {
        const canvasCenter = { x: canvas.width / 2, y: canvas.height / 2 };
        mapPos = rotatePoint(canvasCenter.x, canvasCenter.y, mapPos.x, mapPos.y, localYaw + 270);
    }

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
    if (map == null)
        return

    let mapPos = mapCoordinates(pos);
    let circleRadius, distance, radius, arrowWidth;

    if (zoomSet) {
        mapPos = boundingCoordinates(mapPos, boundingRect);
        circleRadius = boundingScale(7, boundingRect);
        distance = circleRadius + boundingScale(2, boundingRect);
        radius = distance + boundingScale(2, boundingRect);
        arrowWidth = 35;
    } else if (playerCentered && localPlayerPos) {
        const playerMapPos = mapCoordinates(localPlayerPos);
        const zoomLevel = 0.5;
        const viewWidth = image.width * zoomLevel;
        const viewHeight = image.height * zoomLevel;

        mapPos.x = (mapPos.x - (playerMapPos.x - viewWidth / 2)) * canvas.width / viewWidth;
        mapPos.y = (mapPos.y - (playerMapPos.y - viewHeight / 2)) * canvas.height / viewHeight;

        circleRadius = 7;
        distance = circleRadius + 2;
        radius = distance + 5;
        arrowWidth = 35;
    } else {
        mapPos.x = mapPos.x * canvas.width / image.width;
        mapPos.y = mapPos.y * canvas.height / image.height;

        circleRadius = 7;
        distance = circleRadius + 2;
        radius = distance + 5;
        arrowWidth = 35;
    }

    let adjustedYaw = yaw;
    if (rotateMap) {
        const canvasCenter = { x: canvas.width / 2, y: canvas.height / 2 };
        mapPos = rotatePoint(canvasCenter.x, canvasCenter.y, mapPos.x, mapPos.y, localYaw + 270);

        if (playerType === "Local") {
            adjustedYaw = 90;
        } else {
            adjustedYaw = (yaw + 180) - localYaw + 270;
        }
    }

    if (dormant) {
        ctx.font = "20px Arial";
        ctx.textAlign = "center";
        ctx.fillStyle = fillStyle;
        ctx.fillText("?", mapPos.x, mapPos.y);
    } else {
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

        if (hasAwp && false) {
            let style = "yellow";

            if (playerType == "Enemy") {
                style = "orange";
            }

            ctx.beginPath();
            ctx.arc(mapPos.x, mapPos.y, circleRadius / 1.5, 0, 2 * Math.PI);
            ctx.fillStyle = style;
            ctx.fill();
        }

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

            if (playerType == "Enemy")
                ctx.strokeStyle = enemyColor;
            else
                ctx.strokeStyle = teamColor;

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
    console.log(`[radarflow] loading map ${mapName}`);
    loaded = true;
    const map_img = new Image();
    map_img.src = `assets/image/${mapName}_radar_psd.png`;

    fetch(`assets/json/${mapName}.json`)
        .then(response => response.json())
        .then(data => {
            map = data;
        })
        .catch(error => {
            console.error('Error loading JSON file:', error);
        });

    map_img.onload = () => {
        image = map_img;
        update = true;
    };
}

function unloadMap() {
    console.log("[radarflow] unloading map");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    map = null;
    mapName = null;
    loaded = false,
    update = true;
    requestAnimationFrame(render);
}

function connect() {
    if (websocket == null) {
        let socket = new WebSocket(websocketAddr);

        socket.onopen = () => {
            console.log("[radarflow] Connection established");
            websocket.send("requestInfo");
        };

        socket.onmessage = (event) => {
            if (event.data == "error") {
                console.log("[radarflow] Server had an unknown error");
            } else {
                try {
                    let data = JSON.parse(event.data);
                    radarData = data;
                    freq = data.freq;

                    if (data.money_reveal_enabled !== undefined) {
                        document.getElementById("moneyReveal").checked = data.money_reveal_enabled;
                    }

                    if (data.ingame == false) {
                        mapName = null;
                        entityData = null;

                        if (loaded)
                            unloadMap();
                    } else {
                        if (!loaded) {
                            mapName = data.mapName;
                            entityData = data.entityData;
                            loadMap(mapName);
                        } else {
                            entityData = data.entityData;
                        }
                    }

                    update = true;
                    requestAnimationFrame(render);
                } catch (e) {
                    console.error("[radarflow] Error parsing server message:", e, event.data);
                }
            }
        };

        socket.onclose = (event) => {
            if (event.wasClean) {
                console.log("[radarflow] connection closed");
            } else {
                console.log("[radarflow] connection died");
            }

            playerData = null;
            websocket = null;
            unloadMap();

            setTimeout(function () {
                connect();
            }, 1000);
        };

        socket.onerror = (error) => {
            console.log(`[radarflow] websocket error: ${error}`);
        };

        websocket = socket;
    } else {
        setTimeout(() => {
            connect();
        }, 1000);
    }
}

addEventListener("DOMContentLoaded", (e) => {
    document.getElementById("zoomCheck").checked = false;
    document.getElementById("statsCheck").checked = true;
    document.getElementById("namesCheck").checked = true;
    document.getElementById("gunsCheck").checked = true;
    document.getElementById("moneyReveal").checked = false;
    document.getElementById("rotateCheck").checked = true;
    document.getElementById("centerCheck").checked = true;

    canvas = document.getElementById('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    canvasAspectRatio = canvas.width / canvas.height;
    ctx = canvas.getContext('2d');

    console.log(`[radarflow] connecting to ${websocketAddr}`);
    connect();
});

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
        websocket.send("toggleMoneyReveal");
    }
}