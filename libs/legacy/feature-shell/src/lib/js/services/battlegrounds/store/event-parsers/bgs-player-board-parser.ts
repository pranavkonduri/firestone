import { Entity } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { defaultStartingHp, GameTag, GameType } from '@firestone-hs/reference-data';
import { BgsBattleInfo } from '@firestone-hs/simulate-bgs-battle/dist/bgs-battle-info';
import { BgsBoardInfo } from '@firestone-hs/simulate-bgs-battle/dist/bgs-board-info';
import { BgsPlayerEntity, BoardTrinket } from '@firestone-hs/simulate-bgs-battle/dist/bgs-player-entity';
import { BoardEntity } from '@firestone-hs/simulate-bgs-battle/dist/board-entity';
import { BoardSecret } from '@firestone-hs/simulate-bgs-battle/dist/board-secret';
import {
	BattlegroundsState,
	BgsBattleSimulationService,
	BgsBoard,
	BgsGame,
	BgsIntermediateResultsSimGuardianService,
	BgsPlayer,
	buildBgsEntities,
	PlayerBoard,
	PlayerBoardEntity,
} from '@firestone/battlegrounds/core';
import { GameState, GameUniqueIdService } from '@firestone/game-state';
import { BgsEntity, MemoryBgsPlayerInfo, MemoryInspectionService } from '@firestone/memory';
import { LogsUploaderService, PreferencesService } from '@firestone/shared/common/service';
import { CardsFacadeService } from '@firestone/shared/framework/core';
import { Map } from 'immutable';
import { AdService } from '../../../ad.service';
import { GameEvents } from '../../../game-events.service';
import { isSupportedScenario, normalizeHeroCardId } from '../../bgs-utils';
import { BattlegroundsStoreEvent } from '../events/_battlegrounds-store-event';
import { BgsPlayerBoardEvent } from '../events/bgs-player-board-event';
import { EventParser } from './_event-parser';

export class BgsPlayerBoardParser implements EventParser {
	constructor(
		private readonly simulation: BgsBattleSimulationService,
		private readonly logsUploader: LogsUploaderService,
		private readonly gameEventsService: GameEvents,
		private readonly allCards: CardsFacadeService,
		private readonly memory: MemoryInspectionService,
		private readonly gameIdService: GameUniqueIdService,
		private readonly prefs: PreferencesService,
		private readonly guardian: BgsIntermediateResultsSimGuardianService,
		private readonly adService: AdService,
	) {
		window['buildSimulationResut'] = (input: string) => {
			const boardEvent = window['buildPlayerBoardGameEvent'](input);
			const boardBgsEvent = window['buildBgsPlayerBoardEvent'](boardEvent);
			const bgsPlayer: BgsBoardInfo = this.buildBgsBoardInfo(boardBgsEvent.playerBoard);
			const bgsOpponent: BgsBoardInfo = this.buildBgsBoardInfo(boardBgsEvent.opponentBoard);
			const battleInfo: BgsBattleInfo = {
				playerBoard: bgsPlayer,
				opponentBoard: bgsOpponent,
				options: {
					maxAcceptableDuration: 8000,
					numberOfSimulations: 8000,
					skipInfoLogs: false,
				},
				gameState: {
					currentTurn: 1,
					validTribes: [],
				},
			};
			console.debug('[bgs-simulation] built battle info', battleInfo);
		};
	}

	public applies(gameEvent: BattlegroundsStoreEvent, state: BattlegroundsState): boolean {
		return state && state.currentGame && gameEvent.type === 'BgsPlayerBoardEvent';
	}

	public async parse(
		currentState: BattlegroundsState,
		event: BgsPlayerBoardEvent,
		gameState: GameState,
	): Promise<BattlegroundsState> {
		console.log('[bgs-simulation] received board infos');
		console.log(
			'[bgs-simulation] player info',
			event.playerBoard.playerId,
			event.playerBoard.heroCardId,
			event.playerBoard?.board?.map((e) => e.CardId),
		);
		for (let i = 0; i < event.duoPendingBoards?.length; i++) {
			const team = event.duoPendingBoards[i];
			console.log(
				`[bgs-simulation] player friendly team ${i}`,
				team?.playerBoard?.playerId,
				team?.playerBoard?.heroCardId,
				team?.playerBoard?.board?.map((e) => e.CardId),
			);
		}
		console.log(
			'[bgs-simulation] opponent info',
			event.opponentBoard?.playerId,
			event.opponentBoard?.heroCardId,
			event.opponentBoard?.board?.map((e) => e.CardId),
		);
		for (let i = 0; i < event.duoPendingBoards?.length; i++) {
			const team = event.duoPendingBoards[i];
			console.log(
				'[bgs-simulation] player opponent team',
				team?.opponentBoard?.playerId,
				team?.opponentBoard?.heroCardId,
				team?.opponentBoard?.board?.map((e) => e.CardId),
			);
		}

		console.debug(
			'[bgs-simulation] received player boards',
			event,
			currentState.currentGame.getMainPlayer(),
			currentState,
		);

		if (event.playerBoard?.board?.length > 7 || event.opponentBoard?.board?.length > 7) {
			setTimeout(async () => {
				const gameLogsKey = await this.logsUploader.uploadGameLogs();
				console.error(
					'no-format',
					'Too many entities on the board',
					currentState.spectating,
					currentState.currentGame.reviewId,
					gameLogsKey,
					event.playerBoard?.heroCardId,
					event.playerBoard?.board?.map((entity) => entity.CardId),
					event.opponentBoard?.heroCardId,
					event.opponentBoard?.board?.map((entity) => entity.CardId),
				);
			});
			// There shouldn't be any case where the board is assigned to a face-off that is not the last, since logs
			// are procesed in order
			const lastFaceOff = currentState.currentGame.faceOffs[currentState.currentGame.faceOffs.length - 1];
			const updatedFaceOff = lastFaceOff.update({
				battleInfoStatus: 'empty',
				battleInfoMesage: undefined,
			});
			const newFaceOffs = currentState.currentGame.faceOffs.map((f) =>
				f.id === updatedFaceOff.id ? updatedFaceOff : f,
			);
			return currentState.update({
				currentGame: currentState.currentGame.update({
					faceOffs: newFaceOffs,
				}),
			} as BattlegroundsState);
		}

		const player: BgsPlayer = this.updatePlayer(currentState, event.playerBoard);
		const opponent: BgsPlayer = this.updatePlayer(currentState, event.opponentBoard);
		if (!player || !opponent) {
			console.warn('[bgs-simulation] missing player or opponent, returning');
			console.debug('[bgs-simulation] missing player or opponent', player, opponent, currentState);
			return currentState;
		}

		let playerTeammateBoard: PlayerBoard = null;
		let opponentTeammateBoard: PlayerBoard = null;

		// === Debug area
		// const debugPlayerBoard = this.buildPlayerBoard(event.latestPlayerBoard);
		// const debugTeammateBoard = this.buildTeammateBoard(event.teammateBoard, currentState.currentGame.players);
		// console.debug(
		// 	'player and teammate backup info',
		// 	debugPlayerBoard,
		// 	debugTeammateBoard,
		// 	event.latestPlayerBoard,
		// 	event.teammateBoard,
		// 	event.teammateBoard?.Hero?.Tags?.map((t) => ({ Name: GameTag[t.Name], Value: t.Value })),
		// 	currentState,
		// 	event,
		// );
		// === End debug area

		// The issue is that, when only one board is visible during the fight (big loss / victory), we don't get the
		// other teammmate info sent cleanly
		// Best case, we get a duoPendingBoard with the first player remaining board + whatever we can fit of the second player board
		// In this case, we could try to find out the entities that belong to the second player to build an approximation of the
		// teammate's board.
		// For the player's teammate, we should be able to get the exact info based on memory reading at the time the figt starts
		// so that shouldn't be too much of an issue (though we need to make sure the info reflects the state before the fight)
		// For the opponent's teammate, I think we only have this partial info to work with, which is probably better than nothing
		// We need to flag the sim result as "possibly inaccurate" in this case
		// So TODO list:
		// - identify, based on the duoPendingBoards info, which teammate info is missing
		// - if it is the player's teammate, get the info from the memory (this might have to be move forward when receiving the "duoPendingBoards"
		// event, or even earlier)
		// - if the opponent's teammate is missing, this means that it will be present (at least partially) in the opponent pendingDuoBoard info
		//    - if the board total length is <= 7, we more or less have the full info (we'll miss the hand), and can do a sim
		//    - if the board total length is > 7, we'll have to make do with the partial info
		//    - in both cases, we probably should flag the result with "possibly inaccurate" and not send the report to the lambda
		for (const duoPendingBoard of event.duoPendingBoards ?? []) {
			if (playerTeammateBoard == null && duoPendingBoard.playerBoard.playerId !== player.playerId) {
				playerTeammateBoard = duoPendingBoard.playerBoard;
				console.log('[bgs-simulation] assigned playerTeammateBoard');
				console.debug(
					'playerTeammateBoard',
					playerTeammateBoard,
					'duoPendingBoard',
					duoPendingBoard,
					'event',
					event,
					'player',
					player,
				);
			} else if (opponentTeammateBoard == null && duoPendingBoard.opponentBoard.playerId !== opponent.playerId) {
				opponentTeammateBoard = duoPendingBoard.opponentBoard;
				console.log('[bgs-simulation] assigned opponentTeammateBoard');
				console.debug(
					'opponentTeammateBoard',
					opponentTeammateBoard,
					'duoPendingBoard',
					duoPendingBoard,
					'event',
					event,
					'opponent',
					opponent,
				);
			}
		}

		//
		if (!!event.duoPendingBoards?.length && playerTeammateBoard == null) {
			// Limitations: we missing some info about random effects, like Embrace Your Rage
			if (player.playerId === currentState.currentGame.getMainPlayer().playerId) {
				const teammateBoardFromMemory = await this.memory.getBgsPlayerTeammateBoard();
				console.log(
					'[bgs-simulation] found teammate board from memory',
					teammateBoardFromMemory?.Board?.map((e) => e.CardId),
				);
				playerTeammateBoard = this.buildBoardFromMemory(
					teammateBoardFromMemory,
					currentState.currentGame.players,
				);
				console.warn('[bgs-simulation] assigned playerTeammateBoard from memory teammateBoard');
				console.debug(playerTeammateBoard, teammateBoardFromMemory, currentState.currentGame.players);
			} else {
				const playerTeams = event.playerTeams;
				if (playerTeams) {
					const playerBoardFromMemory = playerTeams?.Player;
					console.log(
						'[bgs-simulation] found player board from memory',
						playerBoardFromMemory?.Board?.map((e) => e.CardId),
					);
					playerTeammateBoard = this.buildBoardFromMemory(
						playerBoardFromMemory,
						currentState.currentGame.players,
					);
					// FIXME: this doesn't work, because if we are in a battle, and haven't found the main player,
					// it means that the current board will be the teammate's. Since this only use the board state,
					// it will get the teammate's board (+ maybe some stuff from the player's), but not the player's board
					// playerTeammateBoard = this.buildPlayerBoard(event.playerBoard);
					console.warn('[bgs-simulation] assigned playerTeammateBoard from memory playerBoard.');
					console.debug(playerTeammateBoard, event.playerBoard);
				}
			}
		}
		if (!!event.duoPendingBoards?.length && opponentTeammateBoard == null) {
			opponentTeammateBoard = this.getOpponentTeammateBoard(
				event.duoPendingBoards[event.duoPendingBoards.length - 1]?.opponentBoard,
				opponent,
				currentState.currentGame.players,
			);
			console.warn('[bgs-simulation] assigned opponentTeammateBoard in second phase.');
			console.debug(opponentTeammateBoard, event.duoPendingBoards, opponent, currentState.currentGame.players);
		}

		console.debug(
			'[bgs-simulation] found boards',
			event.playerBoard,
			playerTeammateBoard,
			event.opponentBoard,
			opponentTeammateBoard,
		);
		const playerTeammatePlayer = !!playerTeammateBoard
			? this.updatePlayer(currentState, playerTeammateBoard)
			: null;
		const opponentTeammatePlayer = !!opponentTeammateBoard
			? this.updatePlayer(currentState, opponentTeammateBoard)
			: null;
		console.debug(
			'[bgs-simulation] updates players',
			player,
			playerTeammatePlayer,
			opponent,
			opponentTeammatePlayer,
		);

		const newPlayers: readonly BgsPlayer[] = currentState.currentGame.players
			.map((p) => (p.playerId === player.playerId ? player : p))
			.map((p) => (p.playerId === opponent.playerId ? opponent : p))
			.map((p) =>
				!!playerTeammatePlayer && p.playerId === playerTeammatePlayer.playerId ? playerTeammatePlayer : p,
			)
			.map((p) =>
				!!opponentTeammatePlayer && p.playerId === opponentTeammatePlayer.playerId ? opponentTeammatePlayer : p,
			);

		const bgsPlayer: BgsBoardInfo = this.buildBgsBoardInfo(event.playerBoard);
		const bgsOpponent: BgsBoardInfo = this.buildBgsBoardInfo(event.opponentBoard);
		const playerTeammate: BgsBoardInfo = this.buildBgsBoardInfo(playerTeammateBoard);
		const opponentTeammate: BgsBoardInfo = this.buildBgsBoardInfo(opponentTeammateBoard);

		console.log(
			'[bgs-simulation] found boards',
			bgsPlayer?.board?.map((e) => e.cardId),
			playerTeammate?.board?.map((e) => e.cardId),
			bgsOpponent?.board?.map((e) => e.cardId),
			opponentTeammate?.board?.map((e) => e.cardId),
		);

		const battleInfo: BgsBattleInfo = {
			playerBoard: bgsPlayer,
			playerTeammateBoard: playerTeammate,
			opponentBoard: bgsOpponent,
			opponentTeammateBoard: opponentTeammate,
			options: {
				maxAcceptableDuration: 8000,
				numberOfSimulations: 8000,
				skipInfoLogs: false,
			},
			gameState: {
				currentTurn: currentState.currentGame.currentTurn,
				validTribes: currentState.currentGame.availableRaces,
				anomalies: currentState.currentGame.anomalies,
			},
		};
		const isSupported = isSupportedScenario(battleInfo);
		if (!bgsOpponent?.player?.cardId || !normalizeHeroCardId(bgsOpponent?.player?.cardId, this.allCards)) {
			console.error('[bgs-player-board-parser] missing opponentCardId', event);
		}

		// const opponentCardId = normalizeHeroCardId(event.opponentBoard.heroCardId, this.allCards);
		// There shouldn't be any case where the board is assigned to a face-off that is not the last, since logs
		// are procesed in order
		const lastFaceOff = currentState.currentGame.faceOffs[currentState.currentGame.faceOffs.length - 1];
		if (lastFaceOff == null) {
			console.error(
				'[bgs-player-board-parser] could not find face-off to update',
				lastFaceOff?.opponentPlayerId,
				event.opponentBoard.playerId,
				lastFaceOff,
			);
			console.debug(currentState, event);
			return currentState;
		}

		// TODO: what happens in Duos?
		if (
			lastFaceOff.opponentPlayerId !== event.opponentBoard.playerId &&
			lastFaceOff.opponentPlayerId !== opponentTeammateBoard?.playerId
		) {
			console.error(
				'[bgs-player-board-parser] got incorrect matching face-off',
				lastFaceOff?.opponentPlayerId,
				event.opponentBoard.playerId,
				lastFaceOff,
			);
			console.debug(currentState, event);
			return currentState;
		}

		const prefs = await this.prefs.getPreferences();
		const isPremium = this.adService.enablePremiumFeatures$$.value;
		const shouldUseIntermediateResults =
			prefs.bgsSimShowIntermediaryResults &&
			(isPremium || this.guardian.hasFreeUses(this.gameIdService.uniqueId$$.value));
		const updatedFaceOff = lastFaceOff.update({
			battleInfo: battleInfo,
			battleInfoStatus: shouldUseIntermediateResults ? 'ongoing' : 'waiting-for-result',
			battleInfoMesage: isSupported.reason,
		});
		const newFaceOffs = currentState.currentGame.faceOffs.map((f) =>
			f.id === updatedFaceOff.id ? updatedFaceOff : f,
		);
		console.debug('[bgs-simulation] updated face-off', updatedFaceOff, newFaceOffs);
		const stateAfterFaceOff = currentState.currentGame.update({
			faceOffs: newFaceOffs,
		});
		const newGame = stateAfterFaceOff.update({
			players: newPlayers,
		} as BgsGame);
		const result = currentState.update({
			currentGame: newGame,
		} as BattlegroundsState);

		try {
			this.simulation.startBgsBattleSimulation(
				this.gameIdService.uniqueId$$.value,
				updatedFaceOff.id,
				battleInfo,
				result?.currentGame?.availableRaces ?? [],
				result.currentGame?.currentTurn ?? 0,
				gameState?.reconnectOngoing,
				prefs.bgsEnableSimulationSampleInOverlay,
			);
		} catch (e) {
			console.error('[bgs-player-board-parser] could not start simulation', e.message, e);
		}
		return result;
	}

	private buildBoardFromMemory(
		teammateBoardFromMemory: MemoryBgsPlayerInfo,
		players: readonly BgsPlayer[],
	): PlayerBoard {
		console.debug('[bgs-simulation] found teammate board from memory', teammateBoardFromMemory);
		if (!teammateBoardFromMemory) {
			return null;
		}

		const result: PlayerBoard = {
			playerId:
				teammateBoardFromMemory.Hero?.Tags?.find((tag) => tag.Name === GameTag.PLAYER_ID)?.Value ??
				players.find((player) => player.cardId === teammateBoardFromMemory.Hero?.CardId)?.playerId,
			heroCardId: teammateBoardFromMemory.Hero?.CardId,
			heroPowers: [
				{
					cardId: teammateBoardFromMemory.HeroPower?.CardId,
					entityId: teammateBoardFromMemory.HeroPower?.Tags?.find((t) => t.Name === GameTag.ENTITY_ID)?.Value,
					used:
						teammateBoardFromMemory.HeroPower?.Tags?.find(
							(t) => t.Name === GameTag.BACON_HERO_POWER_ACTIVATED,
						)?.Value === 1,
					info: -1, // We don't have this info yet
					info2: -1, // We don't have this info yet
				},
			],
			globalInfo: null, // We don't have this info yet
			board: teammateBoardFromMemory.Board?.map((entity) => this.buildEntityFromMemory(entity)),
			hand: teammateBoardFromMemory.Hand?.map((entity) => this.buildEntityFromMemory(entity)),
			hero: this.buildEntityFromMemory(teammateBoardFromMemory.Hero),
			secrets: teammateBoardFromMemory.Secrets?.map((entity) => this.buildEntityFromMemory(entity)),
			trinkets: teammateBoardFromMemory.Trinkets?.map((entity) => this.buildTrinketFromMemory(entity)),
			questEntities: [], // No info
			questRewardEntities: [], // No info
			questRewards: [], // No info
		};
		return result;
	}

	private buildEntityFromMemory(entity: BgsEntity): PlayerBoardEntity {
		const entityId = entity.Tags?.find((t) => t.Name === GameTag.ENTITY_ID)?.Value;
		if (!entity.CardId) {
			console.warn('missing cardId in buildEntityFromMemory', entityId, entity.Tags);
		}
		return {
			Id: entityId,
			Entity: entity.Tags?.find((t) => t.Name === GameTag.ENTITY_ID)?.Value,
			CardId: entity.CardId,
			Tags: entity.Tags,
			Enchantments:
				entity.Enchantments?.map((e) => ({
					EntityId: e.Tags?.find((t) => t.Name === GameTag.ENTITY_ID)?.Value,
					CardId: e.CardId,
					TagScriptDataNum1: e.Tags?.find((t) => t.Name === GameTag.TAG_SCRIPT_DATA_NUM_1)?.Value,
					TagScriptDataNum2: e.Tags?.find((t) => t.Name === GameTag.TAG_SCRIPT_DATA_NUM_2)?.Value,
				})) ?? [],
		};
	}

	private buildTrinketFromMemory(entity: BgsEntity): BoardTrinket {
		return {
			entityId: entity.Tags?.find((t) => t.Name === GameTag.ENTITY_ID)?.Value,
			cardId: entity.CardId,
			scriptDataNum1: entity.Tags?.find((t) => t.Name === GameTag.TAG_SCRIPT_DATA_NUM_1)?.Value,
			scriptDataNum2: entity.Tags?.find((t) => t.Name === GameTag.TAG_SCRIPT_DATA_NUM_2)?.Value,
			scriptDataNum6: entity.Tags?.find((t) => t.Name === GameTag.TAG_SCRIPT_DATA_NUM_6)?.Value,
		};
	}

	private buildPlayerBoard(latestPlayerBoard: PlayerBoard): PlayerBoard {
		return latestPlayerBoard;
	}

	private getOpponentTeammateBoard(
		opponentBoard: PlayerBoard,
		opponent: BgsPlayer,
		allPlayers: readonly BgsPlayer[],
	): PlayerBoard {
		const teammateEntities = opponentBoard.board.filter((e) =>
			e.Tags.find((t) => t.Name === GameTag.CONTROLLER && t.Value !== opponent.playerId),
		);
		// TODO: refactor this once we have the concept of teams
		const opponentPosition = opponent.leaderboardPlace;
		const teammatePosition = opponentPosition % 2 === 1 ? opponentPosition + 1 : opponentPosition - 1;
		const teammatePlayer = allPlayers.find((player) => player.leaderboardPlace === teammatePosition);
		const result: PlayerBoard = {
			board: teammateEntities,
			hand: opponentBoard.hand,
			heroCardId: opponentBoard.heroCardId ?? teammatePlayer?.cardId,
			heroPowers: opponentBoard.heroPowers,
			// heroPowerCardId: opponentBoard.heroPowerCardId ?? teammatePlayer?.heroPowerCardId,
			// heroPowerInfo: opponentBoard.heroPowerInfo,
			// heroPowerInfo2: opponentBoard.heroPowerInfo2,
			// heroPowerUsed: opponentBoard.heroPowerUsed,
			playerId:
				opponentBoard.hero.Tags?.find((t) => t.Name === GameTag.PLAYER_ID)?.Value ?? teammatePlayer?.playerId,
			secrets: opponentBoard.secrets,
			trinkets: opponentBoard.trinkets,
			questEntities: opponentBoard.questEntities,
			questRewardEntities: opponentBoard.questRewardEntities,
			questRewards: opponentBoard.questRewards,
			hero: {
				CardId: opponentBoard.heroCardId ?? teammatePlayer?.cardId,
				Entity: 0, // No info
				Id:
					opponentBoard.hero.Tags?.find((t) => t.Name === GameTag.PLAYER_ID)?.Value ??
					teammatePlayer?.playerId,
				Tags: opponentBoard.hero?.Tags,
			},
			globalInfo: {
				EternalKnightsDeadThisGame: opponentBoard.globalInfo?.EternalKnightsDeadThisGame ?? 0,
				TavernSpellsCastThisGame: opponentBoard.globalInfo?.TavernSpellsCastThisGame ?? 0,
				SpellsCastThisGame: opponentBoard.globalInfo?.SpellsCastThisGame ?? 0,
				PiratesPlayedThisGame: opponentBoard.globalInfo?.PiratesPlayedThisGame ?? 0,
				PiratesSummonedThisGame: opponentBoard.globalInfo?.PiratesSummonedThisGame ?? 0,
				BeastsSummonedThisGame: opponentBoard.globalInfo?.BeastsSummonedThisGame ?? 0,
				MagnetizedThisGame: opponentBoard.globalInfo?.MagnetizedThisGame ?? 0,
				UndeadAttackBonus: opponentBoard.globalInfo?.UndeadAttackBonus ?? 0,
				ChoralAttackBuff: opponentBoard.globalInfo?.ChoralAttackBuff ?? 0,
				ChoralHealthBuff: opponentBoard.globalInfo?.ChoralHealthBuff ?? 0,
				FrostlingBonus: opponentBoard.globalInfo?.FrostlingBonus ?? 0,
				AstralAutomatonsSummonedThisGame: opponentBoard.globalInfo?.AstralAutomatonsSummonedThisGame ?? 0,
				BloodGemAttackBonus: opponentBoard.globalInfo?.BloodGemAttackBonus ?? 0,
				BloodGemHealthBonus: opponentBoard.globalInfo?.BloodGemHealthBonus ?? 0,
				BeetleAttackBuff: opponentBoard.globalInfo?.BeetleAttackBuff ?? 0,
				BeetleHealthBuff: opponentBoard.globalInfo?.BeetleHealthBuff ?? 0,
				ElementalAttackBuff: opponentBoard.globalInfo?.ElementalAttackBuff ?? 0,
				ElementalHealthBuff: opponentBoard.globalInfo?.ElementalHealthBuff ?? 0,
				TavernSpellHealthBuff: opponentBoard.globalInfo?.TavernSpellHealthBuff ?? 0,
				TavernSpellAttackBuff: opponentBoard.globalInfo?.TavernSpellAttackBuff ?? 0,
				BattlecriesTriggeredThisGame: opponentBoard.globalInfo?.BattlecriesTriggeredThisGame ?? 0,
				SanlaynScribesDeadThisGame: opponentBoard.globalInfo?.SanlaynScribesDeadThisGame ?? 0,
				FriendlyMinionsDeadLastCombat: opponentBoard.globalInfo?.FriendlyMinionsDeadLastCombat ?? 0,
			},
		};
		return result;
	}

	private buildBgsBoardInfo(playerBoard: PlayerBoard): BgsBoardInfo {
		if (!playerBoard) {
			return null;
		}

		console.debug('[bgs-simulation] building board info', playerBoard);
		const bgsBoard: BoardEntity[] = buildBgsEntities(playerBoard.board, this.allCards);
		const secrets: BoardSecret[] = buildBgsEntities(playerBoard.secrets, this.allCards);
		const trinkets: BoardTrinket[] = [...(playerBoard.trinkets ?? [])];
		const hand: BoardEntity[] = buildBgsEntities(playerBoard.hand, this.allCards);
		let tavernTier = playerBoard.hero.Tags?.find((tag) => tag.Name === GameTag.PLAYER_TECH_LEVEL)?.Value;
		if (!tavernTier) {
			console.warn('[bgs-simulation] no tavern tier', event);
			tavernTier = 1;
		}

		const health =
			(playerBoard.hero.Tags?.find((tag) => tag.Name === GameTag.HEALTH)?.Value ??
				defaultStartingHp(GameType.GT_BATTLEGROUNDS, playerBoard.hero.CardId, this.allCards)) +
			(playerBoard.hero.Tags?.find((tag) => tag.Name === GameTag.ARMOR)?.Value ?? 0);
		const damage = playerBoard.hero?.Tags?.find((tag) => tag.Name === GameTag.DAMAGE)?.Value ?? 0;
		const hpLeft = health - damage;
		if (hpLeft <= 0 || isNaN(hpLeft)) {
			console.warn('hp is 0', health, damage, playerBoard.hero.Tags, playerBoard.hero);
		}
		return {
			player: {
				tavernTier: tavernTier,
				hpLeft: hpLeft,
				cardId: playerBoard.hero.CardId, // In case it's the ghost, the hero power is not active
				entityId: playerBoard.hero.Entity,
				heroPowers: playerBoard.heroPowers,
				// heroPowerId: playerBoard.heroPowerCardId,
				// heroPowerUsed: playerBoard.heroPowerUsed,
				// heroPowerInfo: playerBoard.heroPowerInfo,
				// heroPowerInfo2: playerBoard.heroPowerInfo2,
				questRewards: playerBoard.questRewards,
				questRewardEntities: playerBoard.questRewardEntities,
				questEntities: playerBoard.questEntities,
				hand: hand,
				trinkets: trinkets,
				secrets: secrets,
				globalInfo: {
					EternalKnightsDeadThisGame: playerBoard.globalInfo?.EternalKnightsDeadThisGame ?? 0,
					TavernSpellsCastThisGame: playerBoard.globalInfo?.TavernSpellsCastThisGame ?? 0,
					SpellsCastThisGame: playerBoard.globalInfo?.SpellsCastThisGame ?? 0,
					PiratesPlayedThisGame: playerBoard.globalInfo?.PiratesPlayedThisGame ?? 0,
					PiratesSummonedThisGame: playerBoard.globalInfo?.PiratesSummonedThisGame ?? 0,
					BeastsSummonedThisGame: playerBoard.globalInfo?.BeastsSummonedThisGame ?? 0,
					MagnetizedThisGame: playerBoard.globalInfo?.MagnetizedThisGame ?? 0,
					UndeadAttackBonus: playerBoard.globalInfo?.UndeadAttackBonus ?? 0,
					ChoralAttackBuff: playerBoard.globalInfo?.ChoralAttackBuff ?? 0,
					ChoralHealthBuff: playerBoard.globalInfo?.ChoralHealthBuff ?? 0,
					FrostlingBonus: playerBoard.globalInfo?.FrostlingBonus ?? 0,
					AstralAutomatonsSummonedThisGame: playerBoard.globalInfo?.AstralAutomatonsSummonedThisGame ?? 0,
					BloodGemAttackBonus: playerBoard.globalInfo?.BloodGemAttackBonus ?? 0,
					BloodGemHealthBonus: playerBoard.globalInfo?.BloodGemHealthBonus ?? 0,
					BeetleAttackBuff: playerBoard.globalInfo?.BeetleAttackBuff ?? 0,
					BeetleHealthBuff: playerBoard.globalInfo?.BeetleHealthBuff ?? 0,
					ElementalAttackBuff: playerBoard.globalInfo?.ElementalAttackBuff ?? 0,
					ElementalHealthBuff: playerBoard.globalInfo?.ElementalHealthBuff ?? 0,
					TavernSpellHealthBuff: playerBoard.globalInfo?.TavernSpellHealthBuff ?? 0,
					TavernSpellAttackBuff: playerBoard.globalInfo?.TavernSpellAttackBuff ?? 0,
					BattlecriesTriggeredThisGame: playerBoard.globalInfo?.BattlecriesTriggeredThisGame ?? 0,
					SanlaynScribesDeadThisGame: playerBoard.globalInfo?.SanlaynScribesDeadThisGame ?? 0,
					FriendlyMinionsDeadLastCombat: playerBoard.globalInfo?.FriendlyMinionsDeadLastCombat ?? 0,
				},
				debugArmor: playerBoard.hero.Tags?.find((tag) => tag.Name === GameTag.ARMOR)?.Value,
				debugHealth: playerBoard.hero.Tags?.find((tag) => tag.Name === GameTag.HEALTH)?.Value,
			} as BgsPlayerEntity & { debugArmor: number; debugHealth: number },
			board: bgsBoard,
			secrets: secrets,
		};
	}

	private updatePlayer(currentState: BattlegroundsState, playerBoard: PlayerBoard): BgsPlayer {
		const playerToUpdate = currentState.currentGame.findPlayer(playerBoard.playerId);
		if (!playerToUpdate) {
			if (!currentState.reconnectOngoing && !this.gameEventsService.isCatchingUpLogLines()) {
				console.warn(
					'[bgs-simulation] Could not idenfity player for whom to update board history',
					currentState.currentGame.reviewId,
					playerBoard.heroCardId,
					playerBoard.playerId,
					currentState.currentGame.players.map((player) => player.playerId),
				);
				console.debug('[bgs-simulation] full players', currentState.currentGame.players);
			}
			return null;
		}
		console.debug(
			'[bgs-simulation] found player board to update',
			playerToUpdate.cardId,
			playerToUpdate.playerId,
			playerToUpdate.damageTaken,
			'with new board',
			playerBoard.board.map((entity) => entity.CardId),
			'from old board',
			playerToUpdate.getLastKnownBoardState()?.map((entity) => entity.cardID),
			playerBoard,
		);
		const newHistory: readonly BgsBoard[] = [
			...(playerToUpdate.boardHistory || []),
			BgsBoard.create({
				board: BgsPlayerBoardParser.buildEntities(playerBoard.board),
				turn: currentState.currentGame.currentTurn,
			}),
		];
		const newPlayer: BgsPlayer = playerToUpdate.update({
			boardHistory: newHistory,
		});
		console.debug(
			'[bgs-simulation] update board for player',
			newPlayer.cardId,
			newPlayer.playerId,
			newPlayer.getLastKnownBoardState()?.map((entity) => entity.cardID),
			newPlayer,
		);
		return newPlayer;
	}

	public static buildEntities(logEntities: readonly any[]): readonly Entity[] {
		return logEntities.map((entity) => BgsPlayerBoardParser.buildEntity(entity));
	}

	private static buildEntity(logEntity): Entity {
		return {
			cardID: logEntity.CardId as string,
			id: logEntity.Entity as number,
			tags: BgsPlayerBoardParser.buildTags(logEntity.Tags),
		} as Entity;
	}

	private static buildTags(tags: { Name: number; Value: number }[]): Map<string, number> {
		return Map(tags.map((tag) => [GameTag[tag.Name], tag.Value]));
	}
}
