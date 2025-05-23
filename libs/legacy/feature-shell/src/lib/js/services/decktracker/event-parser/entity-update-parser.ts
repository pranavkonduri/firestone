import { CardIds } from '@firestone-hs/reference-data';
import { DeckCard, DeckState, GameState, getProcessedCard } from '@firestone/game-state';
import { CardsFacadeService } from '@firestone/shared/framework/core';
import { publicCardCreators, shouldKeepOriginalCost } from '@services/hs-utils';
import { GameEvent } from '../../../models/game-event';
import { LocalizationFacadeService } from '../../localization-facade.service';
import { WHIZBANG_DECK_CARD_IDS } from './card-revealed-parser';
import { DeckManipulationHelper } from './deck-manipulation-helper';
import { EventParser } from './event-parser';
import { addAdditionalAttribuesInHand } from './receive-card-in-hand-parser';

export class EntityUpdateParser implements EventParser {
	constructor(
		private readonly helper: DeckManipulationHelper,
		private readonly i18n: LocalizationFacadeService,
		private readonly allCards: CardsFacadeService,
	) {}

	applies(gameEvent: GameEvent, state: GameState): boolean {
		return !!state;
	}

	async parse(currentState: GameState, gameEvent: GameEvent): Promise<GameState> {
		const [cardId, controllerId, localPlayer, entityId] = gameEvent.parse();

		const isPlayer = controllerId === localPlayer.PlayerId;
		const deck = isPlayer ? currentState.playerDeck : currentState.opponentDeck;

		const cardInHand = this.helper.findCardInZone(deck.hand, null, entityId);
		const cardInDeck = this.helper.findCardInZone(deck.deck, null, entityId);
		const cardInOther = this.helper.findCardInZone(deck.otherZone, null, entityId);

		// Some cards discovered by the opponent from their deck leak info in the logs
		// This will probably cause some existing info to disappear, and will have to be removed once the logs are fixed
		const obfsucatedCardId =
			!isPlayer &&
			cardInOther &&
			!cardInOther.cardId &&
			// Added for Benevolent Banker, but I'm pretty sure it will bring back other info leaks
			// Add some comments here with the card in question
			!cardId &&
			!gameEvent.additionalData?.revealed
				? null
				: cardId;
		// console.debug('[entity-update] cardInOther', cardInOther, obfsucatedCardId);

		const shouldShowCardIdInHand =
			// If we don't restrict it to the current player, we create some info leaks in the opponent's hand (eg with Baku)
			cardInHand &&
			// I Don't know why this was introduced. Keeping this prevents some cards to be updated when we do get some
			// additional information about the card, like for Abyssal Curses
			// cardInHand.cardId !== cardId &&
			// Introduced for Lorewalker Cho
			(isPlayer || publicCardCreators.includes(cardInHand.creatorCardId as CardIds));

		const newCardInHand = shouldShowCardIdInHand
			? addAdditionalAttribuesInHand(
					cardInHand.update({
						cardId: obfsucatedCardId,
						cardName: this.allCards.getCard(obfsucatedCardId).name,
						refManaCost: shouldKeepOriginalCost(obfsucatedCardId)
							? cardInHand.refManaCost
							: this.allCards.getCard(obfsucatedCardId)?.cost,
					} as DeckCard),
					deck,
					gameEvent.additionalData.dataNum1,
					gameEvent.additionalData.dataNum2,
					gameEvent,
					this.allCards,
			  )
			: null;
		// console.debug(
		// 	'[entity-update] newCardInHand',
		// 	obfsucatedCardId,
		// 	newCardInHand,
		// 	shouldShowCardIdInHand,
		// 	cardInHand,
		// 	gameEvent,
		// );

		const newCardInDeck = addAdditionalAttribuesInDeck(
			cardInDeck?.cardId !== obfsucatedCardId
				? cardInDeck?.update({
						cardId: obfsucatedCardId,
						cardName: this.allCards.getCard(obfsucatedCardId).name,
						refManaCost: shouldKeepOriginalCost(obfsucatedCardId)
							? cardInDeck.refManaCost
							: this.allCards.getCard(obfsucatedCardId)?.cost,
				  })
				: cardInDeck,
			deck,
			gameEvent,
			this.allCards,
		);
		// console.debug('[entity-update] newCardInDeck', newCardInDeck);
		const newCardInOther =
			cardInOther && cardInOther.cardId !== obfsucatedCardId
				? cardInOther.update({
						cardId: obfsucatedCardId,
						cardName: this.allCards.getCard(obfsucatedCardId).name,
						refManaCost: shouldKeepOriginalCost(obfsucatedCardId)
							? cardInOther.refManaCost
							: this.allCards.getCard(obfsucatedCardId)?.cost,
				  } as DeckCard)
				: null;
		// console.debug(
		// 	'[entity-update] newCardInOther',
		// 	newCardInOther,
		// 	cardInOther,
		// 	obfsucatedCardId,
		// 	cardId,
		// 	gameEvent.additionalData?.revealed,
		// );

		const newHand = newCardInHand ? this.helper.replaceCardInZone(deck.hand, newCardInHand) : deck.hand;
		const newDeck =
			newCardInDeck && newCardInDeck !== cardInDeck
				? this.helper.replaceCardInZone(deck.deck, newCardInDeck)
				: deck.deck;
		const newOther = newCardInOther
			? this.helper.replaceCardInOtherZone(deck.otherZone, newCardInOther, this.allCards)
			: deck.otherZone;
		// console.debug('[entity-update] newOther', newOther, deck.otherZone, newCardInOther);

		let globalEffects = deck.globalEffects;
		if (WHIZBANG_DECK_CARD_IDS.includes(cardId as CardIds) && !globalEffects?.some((c) => c.cardId === cardId)) {
			const dbCard = getProcessedCard(cardId, entityId, deck, this.allCards);
			const globalEffectCard = DeckCard.create({
				entityId: null,
				cardId: cardId,
				cardName: dbCard.name,
				refManaCost: dbCard.cost,
				rarity: dbCard.rarity?.toLowerCase(),
				zone: null,
			} as DeckCard);
			globalEffects = this.helper.addSingleCardToZone(globalEffects, globalEffectCard);
		}

		const newPlayerDeck = Object.assign(new DeckState(), deck, {
			hand: newHand,
			deck: newDeck,
			otherZone: newOther,
			abyssalCurseHighestValue:
				newCardInHand?.cardId === CardIds.SirakessCultist_AbyssalCurseToken
					? Math.max(deck.abyssalCurseHighestValue ?? 0, gameEvent.additionalData.dataNum1 ?? 0)
					: deck.abyssalCurseHighestValue,
			globalEffects: globalEffects,
		});
		// console.debug('[entity-update] newPlayerDeck', newPlayerDeck);

		const result = currentState.update({
			[isPlayer ? 'playerDeck' : 'opponentDeck']: newPlayerDeck,
		});
		// console.debug('[entity-update] result', result);

		return result;
	}

	event(): string {
		return GameEvent.ENTITY_UPDATE;
	}
}

export const addAdditionalAttribuesInDeck = (
	card: DeckCard,
	deck: DeckState,
	gameEvent: GameEvent,
	allCards: CardsFacadeService,
): DeckCard => {
	// console.debug('[entity-update] addAdditionalAttribuesInDeck', card?.cardName, card, gameEvent);
	switch (card?.cardId) {
		case CardIds.Incindius_EruptionToken_VAC_321t:
			return card.update({
				mainAttributeChange:
					!!gameEvent.additionalData.dataNum1 && gameEvent.additionalData.dataNum1 !== -1
						? // dataNum1 is the base value, while we start our count at 0
						  gameEvent.additionalData.dataNum1 - 1
						: card.mainAttributeChange,
			});
	}
	return card;
};
