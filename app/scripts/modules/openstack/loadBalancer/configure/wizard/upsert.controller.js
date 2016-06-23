'use strict';

let angular = require('angular');
require('../../loadBalancer.less');

module.exports = angular.module('spinnaker.loadBalancer.openstack.create.controller', [
  require('angular-ui-router'),
  require('../../../../core/loadBalancer/loadBalancer.write.service.js'),
  require('../../../../core/loadBalancer/loadBalancer.read.service.js'),
  require('../../../../core/account/account.service.js'),
  require('../../../../core/modal/wizard/v2modalWizard.service.js'),
  require('../../../../core/task/monitor/taskMonitorService.js'),
  require('../../../../core/search/search.service.js'),
  require('../../transformer.js'),
  require('../../../../core/region/regionSelectField.directive.js'),
  require('../../../subnet/subnetSelectField.directive.js'),
  require('../../../floatingIp/floatingIpSelectField.directive.js'),
])
  .controller('openstackUpsertLoadBalancerController', function($scope, $uibModalInstance, $state,
                                                                 application, loadBalancer, isNew, loadBalancerReader,
                                                                 accountService, openstackLoadBalancerTransformer,
                                                                 _, searchService, v2modalWizardService, loadBalancerWriter, taskMonitorService) {
    var ctrl = this;
    $scope.isNew = isNew;

    $scope.pages = {
      location: require('./location.html'),
      interface: require('./interface.html'),
      destinations: require('./destinations.html'),
      healthCheck: require('./healthCheck.html'),
    };

    $scope.state = {
      accountsLoaded: false,
      loadBalancerNamesLoaded: false,
      submitting: false
    };

    $scope.regions = [];
    $scope.subnetFilter = {};

    $scope.protocols = ['HTTP', 'HTTPS'];
    $scope.maxPort = 65535;
    $scope.methods = [
      { label: 'Round Robin', value: 'ROUND_ROBIN' },
      { label: 'Least Connections', value: 'LEAST_CONNECTIONS' },
      { label: 'Source IP', value: 'SOURCE_IP' }
    ];

    // initialize controller
    if (loadBalancer) {
      $scope.loadBalancer = openstackLoadBalancerTransformer.convertLoadBalancerForEditing(loadBalancer);
      initializeEditMode();
    } else {
      $scope.loadBalancer = openstackLoadBalancerTransformer.constructNewLoadBalancerTemplate();
      initializeLoadBalancerNames();
    }

    finishInitialization();

    function onApplicationRefresh() {
      // If the user has already closed the modal, do not navigate to the new details view
      if ($scope.$$destroyed) {
        return;
      }
      $uibModalInstance.close();
      var newStateParams = {
        provider: 'openstack',
        name: $scope.loadBalancer.name,
        accountId: $scope.loadBalancer.account,
        region: $scope.loadBalancer.region,
      };
      if (!$state.includes('**.loadBalancerDetails')) {
        $state.go('.loadBalancerDetails', newStateParams);
      } else {
        $state.go('^.loadBalancerDetails', newStateParams);
      }
    }

    function onTaskComplete() {
      application.loadBalancers.refresh();
      application.loadBalancers.onNextRefresh($scope, onApplicationRefresh);
    }

    $scope.taskMonitor = taskMonitorService.buildTaskMonitor({
      application: application,
      title: (isNew ? 'Creating ' : 'Updating ') + 'your load balancer',
      modalInstance: $uibModalInstance,
      onTaskComplete: onTaskComplete,
    });

    var allLoadBalancerNames = {};

    function initializeEditMode() {
    }

    function finishInitialization() {
      accountService.listAccounts('openstack').then(function (accounts) {
        $scope.accounts = accounts;
        $scope.state.accountsLoaded = true;

        var accountNames = _.pluck($scope.accounts, 'name');
        if (accountNames.length && accountNames.indexOf($scope.loadBalancer.account) === -1) {
          $scope.loadBalancer.account = accountNames[0];
        }

        //TODO: remove hard-coded value once we can get the region(s) from the account
        $scope.loadBalancer.region = 'RegionOne';

        ctrl.accountUpdated();
      });
    }

    function initializeLoadBalancerNames() {
      loadBalancerReader.listLoadBalancers('openstack').then(function (loadBalancers) {
        loadBalancers.forEach((loadBalancer) => {
          let account = loadBalancer.account;
          if (!allLoadBalancerNames[account]) {
            allLoadBalancerNames[account] = {};
          }
          let namespace = loadBalancer.namespace;
          if (!allLoadBalancerNames[account][namespace]) {
            allLoadBalancerNames[account][namespace] = [];
          }
          allLoadBalancerNames[account][namespace].push(loadBalancer.name);
        });

        updateLoadBalancerNames();
        $scope.state.loadBalancerNamesLoaded = true;
      });
    }

    function updateLoadBalancerNames() {
      var account = $scope.loadBalancer.account;

      if (allLoadBalancerNames[account]) {
        $scope.existingLoadBalancerNames = _.flatten(_.map(allLoadBalancerNames[account]));
      } else {
        $scope.existingLoadBalancerNames = [];
      }
    }

    // Controller API
    this.updateName = function() {
      $scope.loadBalancer.name = this.getName();
    };

    this.getName = function() {
      var loadBalancer = $scope.loadBalancer;
      var loadBalancerName = [application.name, (loadBalancer.stack || ''), (loadBalancer.detail || '')].join('-');
      return _.trimRight(loadBalancerName, '-');
    };

    this.accountUpdated = function() {
      accountService.getRegionsForAccount($scope.loadBalancer.account).then(function(regions) {
        $scope.regions = _.map(regions, function(r) { return {label: r, value: r}; });
        ctrl.regionUpdated();
      });
    };

    this.regionUpdated = function() {
      //updating the filter triggers a refresh of the subnets
      $scope.subnetFilter = {type: 'openstack', account: $scope.loadBalancer.account, region: $scope.loadBalancer.region};
    };

    this.onSubnetChanged = function() {
      updateFloatingIps();
    };

    function updateFloatingIps() {
      //TODO (jcwest): query, filter by selected subnet, and only include where port_id == None
      $scope.floatingIps = [
        {id: '8cfb7dd3-6767-4d07-a00f-f0ac9ce0922c', floatingIpAddress: '172.24.4.3'},
        {id: 'invalid', floatingIpAddress: 'invalid'}
      ];
    }

    this.namespaceUpdated = function() {
      updateLoadBalancerNames();
      ctrl.updateName();
    };

    this.addStatusCode = function() {
      var newCode = parseInt(this.newStatusCode);
      if( $scope.loadBalancer.healthMonitor.expectedStatusCodes.indexOf(newCode) == -1 ) {
        $scope.loadBalancer.healthMonitor.expectedStatusCodes.push(newCode);
        $scope.loadBalancer.healthMonitor.expectedStatusCodes.sort();
      }
    };

    this.removeStatusCode = function(code) {
      $scope.loadBalancer.healthMonitor.expectedStatusCodes = $scope.loadBalancer.healthMonitor.expectedStatusCodes.filter(function(c) {
        return c != code;
      });
    };

    this.submit = function () {
      var descriptor = isNew ? 'Create' : 'Update';

      this.updateName();
      $scope.taskMonitor.submit(
        function() {
          let params = {
            cloudProvider: 'openstack',
            //TODO(jcwest): remove this hard-coded value once...
            networkId: '044e64f5-5041-4bda-a282-ce3295c27662'
          };
          return loadBalancerWriter.upsertLoadBalancer($scope.loadBalancer, application, descriptor, params);
        }
      );
    };

    this.cancel = function () {
      $uibModalInstance.dismiss();
    };
  });
