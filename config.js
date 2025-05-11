require("dotenv").config();

module.exports = {
    credentials: {
        internal: process.env.INTERNAL_TOKEN,
        telegram: process.env.TELEGRAM_TOKEN,
        utmn: {
            login: process.env.UTMN_LOGIN,
            password: process.env.UTMN_PASSWORD
        }
    },
    database: {
        hostname: process.env.DB_HOSTNAME,
        port: process.env.DB_PORT,
        login: process.env.DB_LOGIN,
        password: process.env.DB_PASSWORD,
        dbname: process.env.DB_NAME
    },
    google: {
        client_id: process.env.GOOGLE_CLIENT_ID,
        secret_id: process.env.GOOGLE_SECRET_ID,
        redirect: process.env.GOOGLE_REDIRECT
    }
};
