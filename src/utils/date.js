let year = (d) => {
    return ("0000" + d.getUTCFullYear()).slice(-4);
};
let month = (d) => {
    return ("00" + (d.getUTCMonth() + 1)).slice(-2);
};
let day = (d) => {
    return ("00" + d.getUTCDate()).slice(-2);
};
let hour = (d) => {
    return ("00" + d.getUTCHours()).slice(-2);
};
let minute = (d) => {
    return ("00" + d.getUTCMinutes()).slice(-2);
};
let second = (d) => {
    return ("00" + d.getUTCSeconds()).slice(-2);
};

function getDates() {
    let first_monday = 0 + 4 * 24 * 60 * 60 * 1000;
    let timestamp = new Date().getTime();
    let diff = (timestamp - first_monday) % (7 * 24 * 60 * 60 * 1000);

    let start_timestamp = timestamp - diff - 5 * 60 * 60 * 1000;
    let end_timestamp = start_timestamp + 3 * 7 * 24 * 60 * 60 * 1000;

    let sd = new Date(start_timestamp);
    let ed = new Date(end_timestamp);

    return {
        start: `${year(sd)}-${month(sd)}-${day(sd)}T19:00:00Z`,
        end: `${year(ed)}-${month(ed)}-${day(ed)}T19:00:00Z`,
        start_timestamp: start_timestamp,
        end_timestamp: end_timestamp,
    };
}

module.exports = {
    year,
    month,
    day,
    hour,
    minute,
    second,
    getDates
}