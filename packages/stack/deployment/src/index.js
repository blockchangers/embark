import {__} from 'embark-i18n';
const async = require('async');

const ContractDeployer = require('./contract_deployer.js');
const cloneDeep = require('clone-deep');
const constants = require('embark-core/constants');

class Deployment {
  constructor(embark, options) {
    this.config = embark.config;

    this.logger = embark.logger;
    this.events = embark.events;
    this.logId = embark.logId;

    // this.events = Object.assign({}, embark.events, {logId: this.logId, logger: this.logger});
    // Object.setPrototypeOf(this.events, embark.events);

    this.plugins = options.plugins;
    this.blockchainConfig = this.config.blockchainConfig;

    this.contractDeployer = new ContractDeployer({
      events: this.events,
      plugins: this.plugins,
      logger: this.logger
    });

    this.events.setCommandHandler('deployment:contracts:deploy', (contractsList, contractDependencies, cb) => {
      this.deployContracts(contractsList, contractDependencies, cb);
    });
  }

  deployContracts(contracts, contractDependencies, done) {
    let subId = this.logger.log({parent_id: this.logId, type: "method", name: "deployContracts", inputs: {contracts, contractDependencies}});

    this.logger.info(__("deploying contracts"));
    async.waterfall([
      // TODO used to be called this.plugins.emitAndRunActionsForEvent("deploy:beforeAll", (err) => {
      (next) => {
        this.plugins.emitAndRunActionsForEvent('deployment:deployContracts:beforeAll', {}, (err) => {
          next(err);
        }, subId);
      },
      (next) => { this.deployAll(contracts, contractDependencies, next); }
    ], (err) => {
      if (err) {
        this.events.emit("outputError", err.message || err);
        this.logger.error(err.message || err);
      }
      this.events.emit('contractsDeployed');
      this.plugins.emitAndRunActionsForEvent('deployment:deployContracts:afterAll', {}, done, subId);
    });
  }

  deployContract(contract, callback) {
    let subId = this.logger.log({parent_id: this.logId, type: "method", name: "deployContract", inputs: {contract}});
    this.events.request('deployment:contract:deploy', contract, (err) => {
      if (err) {
        contract.error = err.message || err;
        if (contract.error === constants.blockchain.gasAllowanceError) {
          this.logger.error(`[${contract.className}]: ${constants.blockchain.gasAllowanceErrorMessage}`);
        } else {
          this.logger.error(`[${contract.className}]: ${err.message || err}`);
        }
        this.logger.log({id: subId, outputs: err, error: true});
        return callback(err);
      }
      this.logger.log({id: subId, outputs: ""});
      callback();
    });
  }

  deployAll(contracts, contractDependencies, done) {
    let subId = this.logger.log({parent_id: this.logId, type: "method", name: "deployAll", inputs: {contracts, contractDependencies}});
    const self = this;
    const contractDeploys = {};
    const errors = [];

    Object.values(contracts).forEach((contract) => {
      function deploy(result, callback) {
        if (typeof result === 'function') callback = result;
        if (contract.addressHandler) {
          return self.events.request('deployment:contract:address', {contract}, (err, address) => {
            if (err) {
              errors.push(err);
            } else {
              contract.address = address;
              contract.deployedAddress = address;
              self.logger.info(__('{{contractName}} already deployed at {{address}}', {contractName: contract.className.bold.cyan, address: contract.address.bold.cyan}));
              self.events.emit("deployment:contract:deployed", contract);
            }
            callback();
          });
        }
        self.deployContract(contract, (err) => {
          if (err) {
            errors.push(err);
          }
          callback();
        });
      }

      const className = contract.className;
      if (!contractDependencies[className] || contractDependencies[className].length === 0) {
        contractDeploys[className] = deploy;
        return;
      }
      contractDeploys[className] = cloneDeep(contractDependencies[className]);
      contractDeploys[className].push(deploy);
    });

    async.auto(contractDeploys, (err, _results) => {
      if (errors.length) {
        err = __("Error deploying contracts. Please fix errors to continue.");

        this.logger.log({id: subId, outputs: err, error: true});
        return done(err);
      }
      if (contracts.length === 0) {
        this.logger.info(__("no contracts found"));
        this.logger.log({id: subId, outputs: "", msg: "no contracts found"});
        return done();
      }
      this.logger.info(__("finished deploying contracts"));
      this.logger.log({id: subId, outputs: err, error: !!err, msg: "finished deploying contracts"});
      done(err);
    });
  }

}

module.exports = Deployment;
