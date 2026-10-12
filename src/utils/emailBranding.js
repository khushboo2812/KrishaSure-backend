// The KrishaSure logo shown at the top of every email. The image is
// served by the web app (frontend repo, public/email-logo.png), so
// that deploy has to be live before emails can show it.
const { APP_URL } = require('../config/env')

const EMAIL_LOGO = `<img src="${APP_URL}/email-logo.png" alt="KrishaSure" width="140" style="display: block; width: 140px; height: auto; margin: 0 0 20px 0; border: 0;" />`

module.exports = { EMAIL_LOGO }
