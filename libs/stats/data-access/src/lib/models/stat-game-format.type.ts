import { GameFormat } from '@firestone-hs/reference-data';

export type StatGameFormatType = 'unknown' | 'all' | 'standard' | 'wild' | 'classic' | 'twist';
export type StatGameFormatTypeExtended = StatGameFormatType | 'tavern-brawl';
export const gameFormatToStatGameFormatType = (source: GameFormat): StatGameFormatType => {
	switch (source) {
		case GameFormat.FT_CLASSIC:
			return 'classic';
		case GameFormat.FT_TWIST:
			return 'twist';
		case GameFormat.FT_STANDARD:
			return 'standard';
		case GameFormat.FT_UNKNOWN:
			return 'unknown';
		case GameFormat.FT_WILD:
			return 'wild';
		default:
			return 'all';
	}
};

export const toFormatType = (formatType: GameFormat): StatGameFormatType => {
	switch (formatType) {
		case GameFormat.FT_UNKNOWN:
			return 'unknown';
		case GameFormat.FT_WILD:
			return 'wild';
		case GameFormat.FT_STANDARD:
			return 'standard';
		case GameFormat.FT_CLASSIC:
			return 'classic';
		case GameFormat.FT_TWIST:
			return 'twist';
		default:
			console.warn('unsupported format type', formatType);
			return 'unknown';
	}
};
