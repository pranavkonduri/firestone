import { CardIds, GameTag, LIBRAM_IDS, Race, ReferenceCard, WATCH_POST_IDS } from '@firestone-hs/reference-data';
import {
	DeckCard,
	DeckState,
	GameState,
	getProcessedCard,
	ShortCard,
	ShortCardWithTurn,
	storeInformationOnCardPlayed,
	toTagsObject,
} from '@firestone/game-state';
import { CardsFacadeService } from '@firestone/shared/framework/core';
import { GameEvent } from '../../../models/game-event';
import {
	battlecryGlobalEffectCards,
	CARDS_IDS_THAT_REMEMBER_SPELLS_PLAYED,
	CARDS_THAT_REMEMBER_SPELLS_PLAYED,
	COUNTERSPELLS,
	globalEffectCardsPlayed,
	hasRace,
} from '../../hs-utils';
import { LocalizationFacadeService } from '../../localization-facade.service';
import { modifyDecksForSpecialCards } from './deck-contents-utils';
import { DeckManipulationHelper } from './deck-manipulation-helper';
import { EventParser } from './event-parser';
import { updateHandWithStonebrewInfo } from './special-cases/stonebrew/stonebrew';

export class CardPlayedFromHandParser implements EventParser {
	constructor(
		private readonly helper: DeckManipulationHelper,
		private readonly allCards: CardsFacadeService,
		private readonly i18n: LocalizationFacadeService,
	) {}

	applies(gameEvent: GameEvent, state: GameState): boolean {
		return !!state;
	}

	async parse(
		currentState: GameState,
		gameEvent: GameEvent,
		additionalInfo?: {
			secretWillTrigger?: {
				cardId: string;
				reactingToCardId: string;
				reactingToEntityId: number;
			};
			minionsWillDie?: readonly {
				cardId: string;
				entityId: number;
			}[];
		},
	): Promise<GameState> {
		const [cardId, controllerId, localPlayer, entityId] = gameEvent.parse();

		const isPlayer = controllerId === localPlayer.PlayerId;
		const deck = isPlayer ? currentState.playerDeck : currentState.opponentDeck;
		let opponentDeck = !isPlayer ? currentState.playerDeck : currentState.opponentDeck;

		// It's important to not automatically populate the cardId here, as
		let card = this.helper.findCardInZone(deck.hand, cardId, entityId, true, false);

		// eslint-disable-next-line prefer-const
		let [newHand, removedCard] = this.helper.removeSingleCardFromZone(
			deck.hand,
			cardId,
			entityId,
			deck.deckList.length === 0 && !gameEvent.additionalData.transientCard,
		);
		// console.debug('[card-played] newHand', newHand, removedCard, card, deck.hand, deck);

		let newDeck = deck.deck;
		// 	removedCard != null ? this.helper.updateDeckForAi(gameEvent, currentState, removedCard) : deck.deck;

		// This happens when we create a card in the deck, then leave it there when the opponent draws it
		// (to avoid info leaks). When they play it we won't find it in the "hand" zone, so we try
		// and see if it is somewhere in the deck
		if (!removedCard?.cardId && cardId && !gameEvent.additionalData.transientCard) {
			// Technically this should also be done in "card-played-by-effect", but the use case is pretty marginal,
			// and not worth the added complexity for now
			if (removedCard?.stolenFromOpponent) {
				const [newDeckAfterReveal, removedCardFromDeck] = this.helper.removeSingleCardFromZone(
					opponentDeck.deck,
					cardId,
					entityId,
					false, // Only remove known cards
				);
				// console.debug(
				// 	'[card-played] newDeckAfterReveal otherDeck',
				// 	newDeckAfterReveal,
				// 	newDeck,
				// 	removedCardFromDeck,
				// );
				if (removedCardFromDeck) {
					removedCard = removedCardFromDeck;
					opponentDeck = opponentDeck.update({
						deck: newDeckAfterReveal,
					});
				}
			} else {
				const [newDeckAfterReveal, removedCardFromDeck] = this.helper.removeSingleCardFromZone(
					newDeck,
					cardId,
					entityId,
					false, // Only remove known cards
				);
				if (removedCardFromDeck) {
					// console.debug('[card-played] newDeckAfterReveal', newDeckAfterReveal, newDeck, removedCardFromDeck);
					removedCard = removedCardFromDeck;
					newDeck = newDeckAfterReveal;
				}
			}
		}

		const isCardCountered =
			((additionalInfo?.secretWillTrigger?.reactingToEntityId &&
				additionalInfo?.secretWillTrigger?.reactingToEntityId === entityId) ||
				(additionalInfo?.secretWillTrigger?.reactingToCardId &&
					additionalInfo?.secretWillTrigger?.reactingToCardId === cardId)) &&
			COUNTERSPELLS.includes(additionalInfo?.secretWillTrigger?.cardId as CardIds);

		// When it's the opponent, sometimes we miss some info like related card ids
		card = !!card?.cardId?.length ? card : removedCard;
		// console.debug('[card-played] card 0', card);
		card = !!card.entityId ? card : card.update({ entityId: entityId });
		// console.debug('[card-played] card 1', card);
		const refCard = getProcessedCard(card?.cardId || cardId, card?.entityId ?? entityId, deck, this.allCards); // this.allCards.getCard(card?.cardId ?? cardId);
		// console.debug('[card-played] refCard', refCard, card, cardId);
		card = !!card.cardId ? card : card.update({ cardId: cardId, cardName: refCard.name });
		// console.debug('[card-played] card 2', card, removedCard);
		// Only minions end up on the board
		const isOnBoard = !isCardCountered && refCard && (refCard.type === 'Minion' || refCard.type === 'Location');
		// console.debug('[card-played] isOnBoard', isOnBoard, refCard, card);
		const costFromTags = gameEvent.additionalData.tags?.find((t) => t.Name === GameTag.COST)?.Value;
		const cardWithZone =
			card?.update({
				zone: isOnBoard ? 'PLAY' : null,
				refManaCost: refCard?.cost,
				actualManaCost: costFromTags ?? card.actualManaCost,
				cardName: card.cardName || refCard?.name,
				rarity: card.rarity?.toLowerCase() ?? refCard?.rarity?.toLowerCase(),
				temporaryCard: false,
				playTiming: isOnBoard ? GameState.playTiming++ : null,
				countered: isCardCountered,
			} as DeckCard) ||
			DeckCard.create({
				entityId: entityId,
				refManaCost: refCard?.cost,
				actualManaCost: costFromTags ?? card.actualManaCost,
				zone: isOnBoard ? 'PLAY' : null,
				cardId: cardId,
				cardName: refCard.name,
				rarity: refCard?.rarity?.toLowerCase(),
				temporaryCard: false,
				playTiming: isOnBoard ? GameState.playTiming++ : null,
				countered: isCardCountered,
			} as DeckCard);
		// console.debug('[card-played] cardWithZone', cardWithZone, card, refCard);
		const cardWithInfo = cardWithZone.update({
			// When dealing with the opponent, the creator card id is hidden / removed when put in deck / drawn to
			// avoid info leaks, so if the info is present in the event, we add it
			creatorCardId: cardWithZone?.creatorCardId ?? gameEvent.additionalData.creatorCardId,
			creatorEntityId: cardWithZone?.creatorEntityId ?? gameEvent.additionalData.creatorEntityId,
			storedInformation: storeInformationOnCardPlayed(cardWithZone.cardId, gameEvent.additionalData.tags),
			tags: toTagsObject(gameEvent.additionalData.tags),
		});
		// console.debug('cardWithInfo', cardWithInfo, gameEvent);
		const cardToAdd =
			isCardCountered && additionalInfo?.secretWillTrigger?.cardId === CardIds.OhMyYogg
				? // Since Yogg transforms the card
				  cardWithInfo.update({
						entityId: undefined,
				  } as DeckCard)
				: cardWithInfo.update({
						relatedCardIds:
							// Reset the related card IDs once you play it, so that the info will be reset if you bounce it back to hand
							CARDS_IDS_THAT_REMEMBER_SPELLS_PLAYED.includes(cardWithInfo.cardId as CardIds)
								? []
								: cardWithInfo.relatedCardIds,
				  });

		const newBoard: readonly DeckCard[] =
			isOnBoard && !isCardCountered ? this.helper.addSingleCardToZone(deck.board, cardToAdd) : deck.board;
		// console.debug('[card-played] newBoard', newBoard, deck.board, cardToAdd);

		const newOtherZone: readonly DeckCard[] = isOnBoard
			? deck.otherZone
			: this.helper.addSingleCardToOtherZone(deck.otherZone, cardToAdd, this.allCards);

		const { newGlobalEffects, battlecriesMultiplier } = updateGlobalEffects(
			deck,
			cardToAdd,
			this.helper,
			isCardCountered,
		);

		const handAfterCardsRemembered = rememberCardsInHand(
			card.cardId,
			isCardCountered,
			newHand,
			this.helper,
			this.allCards,
		);

		// console.debug('[card-played] handAfterCardsRemembered', handAfterCardsRemembered, newHand);
		const handAfterCardsLinks = isCardCountered
			? handAfterCardsRemembered
			: processCardLinks(cardToAdd, handAfterCardsRemembered, this.helper, this.allCards);
		// console.debug('[card-played] handAfterCardsLinks', handAfterCardsLinks, cardToAdd);
		const hardAfterGuessedInfo = addGuessedInfo(cardWithInfo, handAfterCardsLinks, this.allCards);
		// console.debug('[card-played] hardAfterGuessedInfo', hardAfterGuessedInfo);

		const isElemental = refCard?.type === 'Minion' && hasRace(refCard, Race.ELEMENTAL);

		const newPlayerDeck1 = deck
			.update({
				hand: hardAfterGuessedInfo,
				board: newBoard,
				deck: newDeck,
				otherZone: newOtherZone,
				cardsPlayedThisTurn: isCardCountered
					? deck.cardsPlayedThisTurn
					: ([...deck.cardsPlayedThisTurn, cardToAdd] as readonly DeckCard[]),
				cardsCounteredThisTurn: isCardCountered ? deck.cardsCounteredThisTurn + 1 : deck.cardsCounteredThisTurn,
				globalEffects: newGlobalEffects,
				watchpostsPlayedThisMatch:
					deck.watchpostsPlayedThisMatch + (!isCardCountered && this.isWatchpost(refCard) ? 1 : 0),
				libramsPlayedThisMatch:
					deck.libramsPlayedThisMatch + (!isCardCountered && this.isLibram(refCard) ? 1 : 0),
				chaoticTendrilsPlayedThisMatch:
					deck.chaoticTendrilsPlayedThisMatch +
					battlecriesMultiplier * (!isCardCountered && refCard.id === CardIds.ChaoticTendril_YOG_514 ? 1 : 0),
				elementalsPlayedThisTurn: deck.elementalsPlayedThisTurn + (!isCardCountered && isElemental ? 1 : 0),
			})
			.updateSpellsPlayedThisMatch(
				isCardCountered ? null : cardToAdd,
				this.allCards,
				gameEvent.additionalData.cost,
				gameEvent.additionalData.targetEntityId,
			);
		const newPlayerDeck = updatePlayerDeckWithOtherSpecialCases(
			newPlayerDeck1,
			isCardCountered ? null : cardToAdd,
			this.allCards,
		);

		const newCardPlayedThisMatch: ShortCardWithTurn = {
			entityId: cardToAdd.entityId,
			cardId: cardToAdd.cardId,
			side: isPlayer ? 'player' : 'opponent',
			turn: +currentState.currentTurn,
			effectiveCost: gameEvent.additionalData.cost,
		};
		const [playerDeckAfterSpecialCaseUpdate, opponentDeckAfterSpecialCaseUpdate] = modifyDecksForSpecialCards(
			cardToAdd.cardId,
			cardToAdd.entityId,
			isCardCountered,
			newPlayerDeck,
			opponentDeck,
			this.allCards,
			this.helper,
			this.i18n,
		);
		const finalPlayerDeck = playerDeckAfterSpecialCaseUpdate.update({
			cardsPlayedThisMatch: isCardCountered
				? playerDeckAfterSpecialCaseUpdate.cardsPlayedThisMatch
				: ([
						...playerDeckAfterSpecialCaseUpdate.cardsPlayedThisMatch,
						newCardPlayedThisMatch,
				  ] as readonly ShortCardWithTurn[]),
			anachronosTurnsPlayed:
				cardId === CardIds.Anachronos || cardId === CardIds.Anachronos_CORE_RLK_919
					? [...playerDeckAfterSpecialCaseUpdate.anachronosTurnsPlayed, currentState.gameTagTurnNumber]
					: playerDeckAfterSpecialCaseUpdate.anachronosTurnsPlayed,
		});
		// console.debug('deckAfterSpecialCaseUpdate', deckAfterSpecialCaseUpdate);

		return currentState.update({
			[isPlayer ? 'playerDeck' : 'opponentDeck']: finalPlayerDeck,
			[!isPlayer ? 'playerDeck' : 'opponentDeck']: opponentDeckAfterSpecialCaseUpdate,
			cardsPlayedThisMatch: isCardCountered
				? currentState.cardsPlayedThisMatch
				: ([...currentState.cardsPlayedThisMatch, newCardPlayedThisMatch] as readonly ShortCard[]),
		});
	}

	private isWatchpost(refCard: ReferenceCard) {
		return WATCH_POST_IDS.includes(refCard.id as CardIds);
	}

	private isLibram(refCard: ReferenceCard) {
		return LIBRAM_IDS.includes(refCard.id as CardIds);
	}

	event(): string {
		return GameEvent.CARD_PLAYED;
	}
}

export const rememberCardsInHand = (
	cardId: string,
	isCardCountered: boolean,
	hand: readonly DeckCard[],
	helper: DeckManipulationHelper,
	allCards: CardsFacadeService,
): readonly DeckCard[] => {
	let handAfterCardsRemembered = hand;
	if (!isCardCountered) {
		const refCard = allCards.getCard(cardId);
		if (refCard?.type === 'Spell') {
			const commanderSivaraCards = hand.filter((c) =>
				CARDS_IDS_THAT_REMEMBER_SPELLS_PLAYED.includes(c.cardId as CardIds),
			);
			if (!!commanderSivaraCards.length) {
				const newSivaraCards = commanderSivaraCards
					.map((c) => {
						const config = CARDS_THAT_REMEMBER_SPELLS_PLAYED.find((conf) => c.cardId === conf.cardId);
						if (config.mustHaveSpellSchool && !refCard.spellSchool?.length) {
							return null;
						}
						const newRelatedCardIds =
							c.cardId === CardIds.CarressCabaretStar_VAC_449
								? buildCarressCabaretStarRelatedCardIds(cardId, c.relatedCardIds, allCards)
								: [...c.relatedCardIds, cardId].slice(0, config.numberOfCards);
						const result = c.update({
							// Only keep the first N
							relatedCardIds: newRelatedCardIds,
						});
						return result;
					})
					.filter((c) => !!c);
				for (const newCard of newSivaraCards) {
					handAfterCardsRemembered = helper.replaceCardInZone(handAfterCardsRemembered, newCard);
				}
			}
		}
	}

	return handAfterCardsRemembered;
};

const buildCarressCabaretStarRelatedCardIds = (
	newCardId: string,
	relatedCardIds: readonly string[],
	allCards: CardsFacadeService,
): readonly string[] => {
	const existingSpellSchools: readonly string[] = [
		...new Set(
			relatedCardIds
				.map((id) => allCards.getCard(id))
				.map((card) => card?.spellSchool)
				.filter((school) => !!school),
		),
	];
	const newSpellSchool = allCards.getCard(newCardId).spellSchool;
	if (existingSpellSchools.includes(newSpellSchool)) {
		return relatedCardIds;
	}

	const baseRelatedCardIds = allCards
		.getCard(CardIds.CarressCabaretStar_VAC_449)
		.relatedCardDbfIds.map((id) => allCards.getCard(id).id);
	const newRelatedCardIds = relatedCardIds.filter((id) => !baseRelatedCardIds.includes(id));
	return [...newRelatedCardIds, newCardId, ...baseRelatedCardIds];
};

export const processCardLinks = (
	card: DeckCard,
	hand: readonly DeckCard[],
	helper: DeckManipulationHelper,
	allCards: CardsFacadeService,
): readonly DeckCard[] => {
	const linkedCardInHand = hand.find((c) => c.cardCopyLink === card.entityId);
	// console.debug('[card-played] processCardLinks', linkedCardInHand, card, hand);
	if (!linkedCardInHand) {
		return hand;
	}

	const updatedLinkedCardInHand = linkedCardInHand.update({
		cardId: card.cardId,
		cardName: card.cardName,
	});
	// console.debug('[card-played] processCardLinks updatedLinkedCardInHand', updatedLinkedCardInHand);
	const result = helper.updateCardInZone(
		hand,
		updatedLinkedCardInHand.entityId,
		updatedLinkedCardInHand.cardId,
		updatedLinkedCardInHand,
		false,
	);
	// console.debug('[card-played] processCardLinks result', result);
	return result;
};

const addGuessedInfo = (
	playedCard: DeckCard,
	hand: readonly DeckCard[],
	allCards: CardsFacadeService,
): readonly DeckCard[] => {
	switch (playedCard.creatorCardId) {
		case CardIds.HarthStonebrew_CORE_GIFT_01:
		case CardIds.HarthStonebrew_GIFT_01:
			return updateHandWithStonebrewInfo(playedCard, hand, allCards);
	}
	return hand;
};

const updatePlayerDeckWithOtherSpecialCases = (
	deck: DeckState,
	playedCard: DeckCard,
	allCards: CardsFacadeService,
): DeckState => {
	if (!playedCard) {
		return deck;
	}

	const cardsToConsider = [...deck.board, ...deck.otherZone];
	for (const card of cardsToConsider) {
		switch (card.cardId) {
			case CardIds.MistahVistah_VAC_519:
				deck = updateMistahVistah(deck, card, playedCard, allCards);
				break;
		}
	}

	return deck;
};

const updateMistahVistah = (
	deck: DeckState,
	mistahVistah: DeckCard,
	playedCard: DeckCard,
	allCards: CardsFacadeService,
): DeckState => {
	// Only consider spells
	if (allCards.getCard(playedCard.cardId).type !== 'Spell') {
		return deck;
	}

	const scenicVista = deck.otherZone.find(
		(c) =>
			c.cardId === CardIds.MistahVistah_ScenicVistaToken_VAC_519t3 &&
			Math.abs(c.creatorEntityId) === Math.abs(mistahVistah.entityId) &&
			c.zone !== 'REMOVEDFROMGAME',
	);
	if (!scenicVista) {
		return deck;
	}

	const relatedCardIds = [...mistahVistah.relatedCardIds];
	if (!relatedCardIds.length) {
		relatedCardIds.push(CardIds.MistahVistah_ScenicVistaToken_VAC_519t3);
	}

	relatedCardIds.push(playedCard.cardId);
	const newMistahVistah = mistahVistah.update({
		relatedCardIds: relatedCardIds,
	});
	const newBoard = deck.board.some((c) => c.entityId === mistahVistah.entityId)
		? deck.board.map((c) => (c.entityId === mistahVistah.entityId ? newMistahVistah : c))
		: deck.board;
	const newOtherZone = deck.otherZone.some((c) => c.entityId === mistahVistah.entityId)
		? deck.otherZone.map((c) => (c.entityId === mistahVistah.entityId ? newMistahVistah : c))
		: deck.otherZone;

	const relatedCardIdsForGlobalEffect = relatedCardIds.filter(
		(c) => c != CardIds.MistahVistah_ScenicVistaToken_VAC_519t3,
	);
	const newOtherZone2 = newOtherZone.some((c) => c.entityId === scenicVista.entityId)
		? newOtherZone.map((c) =>
				c.entityId === scenicVista.entityId
					? scenicVista.update({ relatedCardIds: relatedCardIdsForGlobalEffect })
					: c,
		  )
		: newOtherZone;

	const scenicVistaGlobalEffect = deck.globalEffects.find(
		(c) => c.cardId === CardIds.MistahVistah_ScenicVistaToken_VAC_519t3,
	);
	const newGlobalEffects = scenicVistaGlobalEffect
		? deck.globalEffects.map((c) =>
				c.cardId === scenicVistaGlobalEffect.cardId
					? scenicVistaGlobalEffect.update({ relatedCardIds: relatedCardIdsForGlobalEffect })
					: c,
		  )
		: deck.globalEffects;
	return deck.update({
		board: newBoard,
		otherZone: newOtherZone2,
		globalEffects: newGlobalEffects,
	});
};

export const updateGlobalEffects = (
	deck: DeckState,
	card: DeckCard,
	helper: DeckManipulationHelper,
	isCardCountered: boolean,
): { battlecriesMultiplier: number; newGlobalEffects: readonly DeckCard[] } => {
	let newGlobalEffects: readonly DeckCard[] = deck.globalEffects;
	let battlecriesMultiplier = 1;
	if (!isCardCountered && globalEffectCardsPlayed.includes(card?.cardId as CardIds)) {
		battlecriesMultiplier = 1;
		const doubleBattlecries = deck.board.some((c) =>
			[CardIds.BrannBronzebeard_CORE_LOE_077, CardIds.BrannBronzebeard_LOE_077].includes(c.cardId as CardIds),
		);
		if (battlecryGlobalEffectCards.includes(card?.cardId as CardIds) && doubleBattlecries) {
			battlecriesMultiplier = 2;
		}
		if (
			battlecryGlobalEffectCards.includes(card?.cardId as CardIds) &&
			deck.enchantments.map((e) => e.cardId).includes(CardIds.HeartOfVirnaal_HeartOfVirnaalEnchantment)
		) {
			battlecriesMultiplier = 2;
		}

		// Hero enchantments, like Shudderblock and Heart of Vir'naal
		if (
			battlecryGlobalEffectCards.includes(card?.cardId as CardIds) &&
			deck.enchantments.map((e) => e.cardId).includes(CardIds.Shudderblock_ReadyForActionEnchantment_TOY_501e)
		) {
			battlecriesMultiplier = 3;
		}

		for (let i = 0; i < battlecriesMultiplier; i++) {
			newGlobalEffects = helper.addSingleCardToZone(
				newGlobalEffects,
				card?.update({
					// So that if the card is sent back to hand, we can track multiple plays of it
					entityId: null,
				}),
			);
			// console.debug('added global effect', newGlobalEffects);
		}
	}
	return { battlecriesMultiplier, newGlobalEffects };
};
