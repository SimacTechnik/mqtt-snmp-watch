const fs = require('fs');
const mqtt = require('mqtt');
const path = require('path');
const snmp = require('net-snmp');

const settingsPath = path.resolve(__dirname, "settings.json");

if(!fs.existsSync(settingsPath)) {
    console.error("Unable to find file settings.json");
    process.exit(1);
}

let strSettings;

try {
    strSettings = fs.readFileSync(settingsPath);
} catch(error) {
    warn("Unable to read file settings.json");
    err(error.message);
}

let settings;

try {
    settings = JSON.parse(strSettings);
} catch(error) {
    warn("Unable to parse settings.json file");
    err(error.message);
}

if(settings["mqtt"] == null) {
    err("Missing mqtt key in settings.json file");
    process.exit(1);
}

const mqttSettings = settings["mqtt"];

if(mqttSettings["url"] == null) {
    err("Missing url key in mqtt object of settings.json file");
}

const mqttUrl = mqttSettings["url"];

if(mqttSettings["username"] == null) {
    err("Missing username key in mqtt object of settings.json file");
}

const mqttUsername = mqttSettings["username"];

if(mqttSettings["topic"] == null) {
    err("Missing topic key in mqtt object of settings.json file");
}

const mqttTopic = mqttSettings["topic"];

const client = mqtt.connect(mqttUrl, {username: mqttUsername, clean: false, clientId: "snmpClient"});

const maxObjCount = 1;

let connected = false;

let dataBuffer = [];

let mqttInterval = null;

let snmpInterval = null;

let sending = false;

client.on('connect', function () {
    log("Connected to MQTT");
    connected = true;
    log("Starting interval for buffer handling");
    mqttInterval = setInterval(handleBuffer, 1000);
 });

 client.on('reconnect', function () {
     //log("Reconnecting to MQTT");
     connected = false;
     if(mqttInterval != null) {
        clearInterval(mqttInterval);
        mqttInterval = null;
     }
 });

 client.on('close', function () {
     //log("MQTT connection closed");
     connected = false;
     if(mqttInterval != null) {
        clearInterval(mqttInterval);
        mqttInterval = null;
     }
 });

 client.on('offline', function () {
     log("MQTT client went offline");
     connected = false;
     if(mqttInterval != null) {
        clearInterval(mqttInterval);
        mqttInterval = null;
     }
 })

function err(msg, code=1) {
    process.stderr.write('[' + new Date().getTime().toString() + "]\t" + "ERROR: " + msg + '\n');
    process.exit(code);
}

function log(msg) {
    process.stdout.write('[' + new Date().getTime().toString() + "]\t" + "LOG: " + msg + '\n');
}

function warn(msg) {
    process.stderr.write('[' + new Date().getTime().toString() + "]\t" + "WARNING: " + msg + '\n');
}

function handleBuffer() {
    if(!connected || sending)
        return;
    sending = true;
    let toSend = dataBuffer;
    dataBuffer = [];
    if(toSend.length > 0)
        sendValue(toSend);
    else
        sending = false;
}

function sendValue(values) {
    if(!connected) {
        values.forEach(function(val) {
            dataBuffer.push(val);
        });
        return;
    }
    let sndValues = values.slice(0, maxObjCount);
    if(sndValues.length == 0) {
        sending = false;
        return;
    }
    let toSend = values.splice(maxObjCount);
    let sndObj = {};
    sndObj["timestamp"] = new Date().getTime();
    sndObj["data"] = sndValues;
    client.publish(mqttTopic, JSON.stringify(sndObj), {qos: 1}, function (e) {
        if(e) {
            log("MQTT disconected while sending data");
            sendValue(value);
        }
        else {
            setTimeout(function() {
                sendValue(toSend);
            }, 200);
        }
    });
}

if(settings["interval"] == null) {
    err("Missing interval key in settings.json file");
}

let interval = settings["interval"];

if(settings["submitEvery"] == null) {
    err("Missing submitEvery key in settings.json file");
}

let submitEvery = settings["submitEvery"];

if(settings["community"] == null) {
    err("Missing community key in settings.json file");
}

let community = settings["community"];

if(settings["ip"] == null) {
    err("Missing community key in settings.json file");
}

let ip = settings["ip"];

if(settings["oids"] == null) {
    err("Missing oids key in settings.json file");
}

let oidsObj = settings["oids"];

let oids = Object.keys(oidsObj);

var session = snmp.createSession(ip, community);

function getData() {
    session.get (oids, function (error, varbinds) {
        if (error) {
            //warn(error);
        } else {
            var toSend = {};
            for (var i = 0; i < varbinds.length; i++)
                if (snmp.isVarbindError (varbinds[i]))
                    warn(snmp.varbindError(varbinds[i]))
                else {
                        if(Buffer.isBuffer(varbinds[i].value)){
                            toSend[oidsObj[varbinds[i].oid]] = varbinds[i].value.toString('utf8');
                        } else {
                            toSend[oidsObj[varbinds[i].oid]] = varbinds[i].value;
                        }
                    }
            dataBuffer.push(toSend);
            clearInterval(snmpInterval);
            setTimeout(function(){snmpInterval = setInterval(getData, interval);}, submitEvery*60000);
        }
    });
}

snmpInterval = setInterval(getData, interval);