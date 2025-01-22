window.nip05Config = {
    "domains": [{
        "name": "nostrly.com",
        "regex": ["^[a-z0-9]+$", ""],
        "regexChars": ["[^a-z0-9]", "g"],
        "length": [2, 20],
        "default": true
    }]
}

let stage = 0
let remScale = 1
let firstNameEntry = true
function initStage0() {
    let activeDomain
    let usernameEl = document.getElementById("reg-username")
    let statusEl = document.getElementById("reg-status")
    let pkEl = document.getElementById("reg-pubkey")
    let nextButton = document.getElementById("register-next")
    let warningEl = document.getElementById("pubkey-warning")
    let valid = {
        name: false,
        pk: false
    }
    let whyMap = {
        TOO_SHORT: "name too short",
        TOO_LONG: "name too long",
        REGEX: "name has disallowed characters",
        REGISTERED: "name is registered",
        DISALLOWED_null: "name is blocked",
        DISALLOWED_later: "name will be available later",
    };

    applyConfig()
    let timeout = null
    let price = 0

    if (window.URLSearchParams) {
        let p = new URLSearchParams(location.search)
        if (p.has("n")) {
            usernameEl.value = p.get("n")
            updateNameStatus()
        }
    }

    let canvas = document.createElement('canvas')
    let ctx = canvas.getContext("2d")




    usernameEl.addEventListener("input", (e) => {
        if (stage !== 0) return
        usernameEl.value = usernameEl.value.toLowerCase().replace(activeDomain.regexChars, "")

        updateNameStatus()
    })

    if (usernameEl.value) {
        usernameEl.value = usernameEl.value.toLowerCase().replace(activeDomain.regexChars, "")

        updateNameStatus()
    }

    nextButton.addEventListener("click", (e) => {
        if (nextButton.disabled) return
        if (stage !== 0) return
        nextButton.disabled = true
        pkEl.disabled = true
        usernameEl.disabled = true
        stage = 1
        nextButton.innerText = "loading..."
        let pk = pkEl.value
        if (pk.startsWith("npub1")) {
            let decoded = bech32.decode(pk)
            let bytes = bech32.fromWords(decoded.words)
            pk = bytes.map(el => el.toString(16).padStart(2, "0")).join("")
        }
        fetch("/api/v1/registration/register", {
            method: "PUT",
            headers: { "Content-Type": "application/json", /*"X-PH-ID": posthog.has_opted_out_capturing() ? "" : posthog.get_distinct_id(), "X-PH-GNQ-Override": localStorage.getItem("x-ph-gnq-override") || ""*/ },
            body: JSON.stringify({
                domain: activeDomain.name,
                name: usernameEl.value,
                pk: pk
            })
        })
            .then(res => res.json())
            .then(res => {
                if (res.error) {
                    document.getElementById("reg-error").style.display = ""
                    document.getElementById("reg-errortext").innerText = `error ${res.error}. please contact @semisol.dev`
                    console.log(`error ${res.error}. please contact\n@semisol.dev`)
                } else {
                    let data = [
                        res, usernameEl.value + "@" + activeDomain.name, res.quote.price, Date.now() + (8 * 60 * 60 * 1000)
                    ]
                    try {
                        localStorage.setItem("register-state", JSON.stringify(data))
                    } catch { }
                    initStage1(res, usernameEl.value + "@" + activeDomain.name, res.quote.price)
                    //posthog.capture('register-stage1', { registeringPrice: res.quote.price, registeringName: usernameEl.value + "@" + activeDomain.name, registeringDomain: activeDomain.name, 'public key': pk })
                }
            })
            .catch(e => {
                document.getElementById("reg-error").style.display = ""
                document.getElementById("reg-errortext").innerText = `${e.toString()}\n please contact\@semisol.dev`
                console.log(e.stack)
            })
    })

    let validatePk = () => {
        if (stage !== 0) return
        pkEl.value = pkEl.value.toLowerCase().replace(/[^qpzry9x8gf2tvdw0s3jn54khce6mua7l1268b]/g, "")

        let isValid = pkEl.value.match(/^[0-9a-f]{64}$/)
        if (!isValid) {
            try {
                let decoded = bech32.decode(pkEl.value)
                if (decoded.prefix === "npub") {
                    let bytes = bech32.fromWords(decoded.words)
                    if (bytes.length === 32) {
                        isValid = true
                        debug("[pk-input] passed validation for bech32")
                    }
                }
            } catch (e) {
                debug("[pk-input] failed to validate for hex and bech32, %s", e.toString())
            }
        } else {
            debug("[pk-input] passed validation for hex")
        }
        pkEl.dataset.valid = isValid ? "yes" : "no"
        valid.pk = isValid
        if (isValid && pkEl.value.match(/^[0-9a-f]{64}$/)) {
            warningEl.style.display = "inline-block"
        } else {
            warningEl.style.display = ""
        }
        updateValidity()
    }

    pkEl.addEventListener("input", validatePk)
    if (pkEl.value) validatePk()

    function updateNameStatus() {
        if (stage !== 0) return
        statusEl.dataset.available = "loading"
        valid.name = false
        updateValidity()
        if (!usernameEl.value) {
            clearTimeout(timeout)
            statusEl.innerText = "type in a name to see info..."
            return
        } else {
            statusEl.innerText = "loading..."
        }
        clearTimeout(timeout)
        let fn = () => {
            /*if (!posthog.get_distinct_id) {
                statusEl.innerText = "loading script..."
                timeout = setTimeout(fn, 200)
                return
            }*/
            if (usernameEl.value.length < usernameEl.minLength) {
                statusEl.dataset.available = "no"
                statusEl.innerText = "✖ name too short"
                return
            }
            statusEl.innerText = "loading..."
            let f = firstNameEntry
            firstNameEntry = false
            fetch("/api/v1/registration/availability", {
                method: "POST",
                headers: { "Content-Type": "application/json", /*"X-PH-ID": posthog.has_opted_out_capturing() ? "" : posthog.get_distinct_id(), "X-PH-GNQ-Override": localStorage.getItem("x-ph-gnq-override") || "", "x-log-feature-flag": f?"1":""*/ },
                body: JSON.stringify({
                    domain: activeDomain.name,
                    name: usernameEl.value
                })
            })
                .then(res => res.json())
                .then(res => {
                    if (!res.available) {
                        statusEl.dataset.available = "no"
                        if (res.why === "DISALLOWED") {
                            statusEl.innerText = "✖ " + whyMap[res.why + "_" + res.reasonTag]
                        } else {
                            statusEl.innerText = "✖ " + whyMap[res.why]
                        }
                        firstNameEntry = f
                    } else {
                        valid.name = true
                        updateValidity()
                        switch (res.quote.data.type) {
                            case "premium": {
                                statusEl.dataset.available = "premium"
                                statusEl.innerText = `✔ for ${shorten(res.quote.price)} sat (premium)`
                                break
                            }
                            case "short": {
                                statusEl.dataset.available = "premium"
                                statusEl.innerText = `✔ for ${shorten(res.quote.price)} sat (short)`
                                break
                            }
                            default: {
                                statusEl.dataset.available = "yes"
                                statusEl.innerText = `✔ for ${shorten(res.quote.price)} sat`
                                break
                            }
                        }
                        price = res.quote.price
                    }
                })
                .catch(e => {
                    statusEl.dataset.available = "no"
                    statusEl.innerText = "✖ server error, try reloading"
                    console.error(e.stack)
                    firstNameEntry = f
                })
        }
        timeout = setTimeout(fn, 200)
    }

    function shorten(amount) {
        if (amount < 1000) return amount.toString()
        return `${(amount / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}k`
    }

    function updateValidity() {
        let isValid = Object.values(valid).reduce((a, b) => (a && b))
        nextButton.disabled = !isValid
    }

    function applyConfig() {
        let config = nip05Config.domains.find(el => el.name === 'nostrly.com')
        usernameEl.minLength = config.length[0]
        usernameEl.maxLength = config.length[1]
        activeDomain = config
    }
}
function initStage1(data, name, price) {
    document.getElementById("stage0").style.display = "none"
    document.getElementById("stage1").style.display = ""
    let token = data.token
    let imgEl = document.getElementById("invoice-img")
    let linkEl = document.getElementById("invoice-link")
    let copyButton = document.getElementById("invoice-copy")
    let cancelButton = document.getElementById("cancel-registration")
    let registeringEl = document.getElementById("registering-name")
    linkEl.href = "lightning:" + data.invoice
    registeringEl.innerText = name
    document.getElementById("registering-name-2").innerText = name
    document.getElementById("phash").innerText = data.paymentHash
    imgEl.src = data.img
    let timeout
    copyButton.addEventListener("click", () => {
        clearTimeout(timeout)
        copyTextToClipboard(data.invoice)
        copyButton.innerText = "copied!"
        timeout = setTimeout(() => {
            copyButton.innerText = "copy"
        }, 1000)
    })
    cancelButton.addEventListener("click", () => {
        try { localStorage.removeItem("register-state") } catch { }
        location.reload()
    })
    let done = false
    let interval = setInterval(() => {
        checkFN()
    }, 5000)
    addEventListener("focus", () => {
        if (!done)
            checkFN()
    })
    function checkFN() {
        fetch("/api/v1/registration/register/check", {
            headers: {
                Authorization: token,
                //"X-PH-ID": posthog.has_opted_out_capturing() ? "" : posthog.get_distinct_id(),
                "x-client": "web",
            },
            method: "POST"
        })
            .then(res => res.json())
            .then(res => {
                if (!res.available && !res.error) {
                    if (done) return
                    done = true
                    document.getElementById("stage1").style.display = "none"
                    document.getElementById("stage3").style.display = ""
                    clearInterval(interval)
                    //posthog.capture('register-conflict', { conflictingHash: data.paymentHash, registeringPrice: price })
                } else if (res.paid) {
                    done = true
                    try { localStorage.removeItem("register-state") } catch { }
                    document.getElementById("stage1").style.display = "none"
                    document.getElementById("stage2").style.display = ""
                    document.getElementById("password").innerText = res.password
                    clearInterval(interval)
                    let timeout2
                    document.getElementById("password-copy").addEventListener("click", () => {
                        clearTimeout(timeout2)
                        copyTextToClipboard(res.password)
                        document.getElementById("password-copy").innerText = "copied!"
                        timeout2 = setTimeout(() => {
                            document.getElementById("password-copy").innerText = "copy"
                        }, 1000)
                    })
                    /*let uid = posthog.get_distinct_id()
                    posthog.identify(res.distinctID, {
                        email: name
                    })
                    posthog.people.set_once({ 'distinct id': uid })*/
                    try { localStorage.setItem("login-password", res.password) } catch { }
                }
            })
            .catch(e => {
                console.error(e.stack)
            })
    }
}

function start() {
    let rs
    try {
        rs = localStorage.getItem("register-state")
    } catch { }
    if (rs) {
        let item = JSON.parse(rs)
        if (item[3] < Date.now()) {
            initStage0()
        } else {
            initStage1(...item)
        }
    } else {
        initStage0()
    }
}

if (document.readyState === "complete") {
    start()
} else {
    addEventListener("load", start)
}

function fallbackCopyTextToClipboard(text) {
    var textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        document.execCommand('copy')
    } catch (err) { }
    document.body.removeChild(textArea);
}
function copyTextToClipboard(text) {
    if (!navigator.clipboard) return fallbackCopyTextToClipboard(text)
    navigator.clipboard.writeText(text).then(() => { }, () => { })
}

let sp = new URLSearchParams(location.search)
function debug(...n) {
    if (sp.has("debug")) {
        console.debug(...n)
    }
}
