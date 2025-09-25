const chalk = require('chalk');


module.exports = {
    successMessage(message){
        console.log(chalk.bgGreenBright.black` Success ` + ` ${message}`);
    },
    errorMessage(message){
        console.log(chalk.bgRedBright.black` Error ` + ` ${message}`);
    },
    infoMessage(message){
        console.log(chalk.inverse` Info ` + ` ${message}`);
    },
    warnMessage(message){
        console.log(chalk.bgYellowBright` Warning ` + ` ${message}`);
    }
};