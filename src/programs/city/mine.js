'use strict'

/**
 * Mine sources in local room, placing energy in storage.
 */

class CityMine extends kernel.process {
  constructor (...args) {
    super(...args)
    this.priority = PRIORITIES_CONSTRUCTION
  }

  getDescriptor () {
    if (this.data.mine) {
      return `${this.data.room} to ${this.data.mine}`
    } else {
      return this.data.room
    }
  }

  main () {
    if (!Game.rooms[this.data.room]) {
      return this.suicide()
    }
    this.room = Game.rooms[this.data.room]

    if (this.data.mine && this.data.mine !== this.data.room) {
      this.scout()
      if (!Game.rooms[this.data.mine]) {
        return
      }
      this.mine = Game.rooms[this.data.mine]
      this.reserveRoom()
    } else {
      this.mine = this.room
    }

    this.sources = this.mine.find(FIND_SOURCES)
    let source
    for (source of this.sources) {
      this.mineSource(source)
    }
  }

  mineSource (source) {
    // Identify where the miner should sit and any container should be built
    const minerPos = source.getMiningPosition()

    // Look for a container
    const containers = _.filter(minerPos.lookFor(LOOK_STRUCTURES), (a) => a.structureType === STRUCTURE_CONTAINER)
    const container = containers.length > 0 ? containers[0] : false

    // Build container if it isn't there
    let construction = false
    if (!container) {
      const constructionSites = minerPos.lookFor(LOOK_CONSTRUCTION_SITES)
      if (constructionSites.length <= 0) {
        this.mine.createConstructionSite(minerPos, STRUCTURE_CONTAINER)
      } else {
        construction = constructionSites[0]
      }
    }

    // Run miners.
    const miners = new qlib.Cluster('miners_' + source.id, this.room)

    // Check if a replacement miner is needed and spawn it early
    const minerCreeps = miners.getCreeps()
    let minerQuantity = 1
    if (miners.getClusterSize() === 1 && minerCreeps.length > 0 && minerCreeps[0].ticksToLive < 60) {
      minerQuantity = 2
    }

    miners.sizeCluster('miner', minerQuantity, {'priority': 2})
    miners.forEach(function (miner) {
      if (!miner.pos.isNearTo(source)) {
        miner.travelTo(minerPos)
        return
      }
      if (construction && miner.carry[RESOURCE_ENERGY]) {
        miner.build(construction)
        return
      }
      if (source.energy > 0) {
        miner.harvest(source)
      } else if (miner.carry[RESOURCE_ENERGY] && container && container.hits < container.hitsMax) {
        miner.repair(container)
      }
    })

    // If using containers spawn haulers
    if (!container || !this.room.storage) {
      return
    }

    const storage = this.room.storage
    const haulers = new qlib.Cluster('haulers_' + source.id, this.room)
    let distance = 50
    if (this.mine.name === this.room.name) {
      haulers.sizeCluster('hauler', 1)
    } else {
      if (!this.data.ssp) {
        this.data.ssp = {}
      }
      if (!this.data.ssp[source.id]) {
        this.data.ssp[source.id] = this.room.findPath(this.room.storage, source, {
          ignoreCreeps: true,
          maxOps: 6000
        }).length
      }
      distance = this.data.ssp[source.id]
      const carryAmount = (Math.ceil((this.data.ssp[source.id] * 20) / 100) * 100) + 200
      const carryCost = BODYPART_COST['move'] + BODYPART_COST['carry']
      const maxEnergy = carryCost * (MAX_CREEP_SIZE / 2)
      let energy = (carryAmount / CARRY_CAPACITY) * carryCost // 50 carry == 1m1c == 100 energy
      let quantity = 1
      if (energy > maxEnergy) {
        quantity = 2
        energy = maxEnergy
      }
      haulers.sizeCluster('hauler', quantity, {'energy': maxEnergy})
    }

    haulers.forEach(function (hauler) {
      if (hauler.ticksToLive < (distance + 30)) {
        return hauler.recycle()
      }
      if (hauler.getCarryPercentage() > 0.8) {
        if (!hauler.pos.isNearTo(storage)) {
          hauler.travelTo(storage)
        } else {
          hauler.transferAll(storage, RESOURCE_ENERGY)
        }
        return
      }
      if (!hauler.pos.isNearTo(container)) {
        hauler.travelTo(container)
      }
      if (hauler.pos.isNearTo(container)) {
        if (container.store[RESOURCE_ENERGY]) {
          hauler.withdraw(container, RESOURCE_ENERGY)
        }
      }
    })
  }

  scout () {
    const center = new RoomPosition(25, 25, this.data.mine)
    const quantity = Game.rooms[this.data.mine] ? 0 : 1
    const scouts = new qlib.Cluster('scout_' + this.data.mine, this.room)
    scouts.sizeCluster('spook', quantity)
    scouts.forEach(function (scout) {
      if (scout.room.name === center.roomName) {
        if (scout.pos.getRangeTo(center) <= 20) {
          return
        }
      }
      scout.travelTo(center, {range: 20})
    })
  }

  reserveRoom () {
    const controller = this.mine.controller
    const timeout = controller.reservation ? controller.reservation.ticksToEnd : 0
    let quantity = 0
    if (timeout < 3500) {
      quantity = Math.min(this.room.getRoomSetting('RESERVER_COUNT'), controller.pos.getSteppableAdjacent().length)
    }

    const reservists = new qlib.Cluster('reservists_' + this.mine.name, this.room)
    reservists.sizeCluster('reservist', quantity)
    reservists.forEach(function (reservist) {
      if (!reservist.pos.isNearTo(controller)) {
        reservist.travelTo(controller)
      } else if (!controller.reservation || timeout < (CONTROLLER_RESERVE_MAX - 5)) {
        reservist.reserveController(controller)
      }
    })
  }
}

module.exports = CityMine
