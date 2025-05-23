import { DeckCard, DeckState, GameState } from '@firestone/game-state';
import { CardsFacadeService } from '@firestone/shared/framework/core';
import { reverseIfNeeded } from '@legacy-import/src/lib/js/services/decktracker/event-parser/card-dredged-parser';
import { GameEvent } from '../../../models/game-event';
import { LocalizationFacadeService } from '../../localization-facade.service';
import { DeckManipulationHelper } from './deck-manipulation-helper';
import { EventParser } from './event-parser';

export class CardChangedInDeckParser implements EventParser {
	constructor(
		private readonly helper: DeckManipulationHelper,
		private readonly allCards: CardsFacadeService,
		private readonly i18n: LocalizationFacadeService,
	) {}

	applies(gameEvent: GameEvent, state: GameState): boolean {
		return state && gameEvent.type === GameEvent.CARD_CHANGED_IN_DECK;
	}

	async parse(currentState: GameState, gameEvent: GameEvent): Promise<GameState> {
		const [cardId, controllerId, localPlayer, entityId] = gameEvent.parse();

		const isPlayer = reverseIfNeeded(controllerId === localPlayer.PlayerId, gameEvent.additionalData.creatorCardId);
		const deck = isPlayer ? currentState.playerDeck : currentState.opponentDeck;

		//console.debug('changing card in deck', gameEvent, currentState);
		const previousDeck = deck.deck;
		const [newDeck, theCard] = this.helper.removeSingleCardFromZone(
			previousDeck,
			cardId,
			entityId,
			deck.deckList.length === 0,
			true,
		);
		if (!theCard) {
			// console.warn('could not find card in deck', cardId, entityId);
			return currentState;
		}

		//console.debug('newDeck, theCard', newDeck, theCard);
		// When card is changed in deck (eg Galakrond), a new card is created
		const realCardId = !!cardId?.length ? cardId : theCard.cardId;
		//console.debug('realCardId', realCardId);
		const cardData = cardId != null ? this.allCards.getCard(realCardId) : null;
		// Ignite for instance receives a CARD_CHANGED_IN_DECK event, and we want to
		// keep all the other attributes.
		// I'm not sure yet if there are instances where we want to remove the
		// previous attributes
		const newCard = theCard.update({
			cardId: realCardId,
			entityId: entityId ?? theCard.entityId,
			cardName: cardData.name,
			refManaCost: cardData?.cost,
			rarity: cardData && cardData.rarity ? cardData.rarity.toLowerCase() : undefined,
			creatorCardId: gameEvent.additionalData?.creatorCardId ?? theCard.creatorCardId,
			creatorEntityId: gameEvent.additionalData.creatorEntityId,
			lastAffectedByCardId: gameEvent.additionalData.lastInfluencedByCardId ?? theCard.lastAffectedByCardId,
			temporaryCard: false,
		} as DeckCard);
		const deckWithNewCard: readonly DeckCard[] = this.helper.addSingleCardToZone(newDeck, newCard);

		const newPlayerDeck = Object.assign(new DeckState(), deck, {
			deck: deckWithNewCard,
		} as DeckState);
		return Object.assign(new GameState(), currentState, {
			[isPlayer ? 'playerDeck' : 'opponentDeck']: newPlayerDeck,
		});
	}

	event(): string {
		return GameEvent.CARD_CHANGED_IN_DECK;
	}
}
