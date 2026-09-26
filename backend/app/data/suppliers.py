"""
The supplier list, transcribed from the handwritten sheet.

Each line on that sheet was a name and what the business buys from them, so
what they supply is kept as the supplier's notes - it is the thing somebody
actually needs when deciding who to order from, and there is nowhere else in
the record that says it.

Readings that were not obvious are noted against the entry rather than
silently corrected.
"""

#: (name, what they supply, note about the reading)
SUPPLIERS = [
    ("Rich", "Truffle base, Excel whip, butter cream, glaze", ""),
    ("Amul", "Fresh cream, Mithai Mate", ""),
    ("Pillsbury", "Vanilla premix, chocolate premix", ""),
    ("Chirag", "Red velvet powder", ""),
    ("Tower", "Brownie", ""),
    ("Samoa", "Filling", "sheet reads 'FeeLINGE' - read as filling"),
    ("Osterberg", "Crush", ""),
    ("Vibhor", "Refined oil", "sheet reads 'REFINED' only"),
    ("Colourmist", "Liquid colour", ""),
    ("AST", "Liquid glucose", ""),
    ("Vizyon", "Sugar paste", ""),
    (
        "Byond",
        "Milk, dark and white chocolate; dark and white chocochips",
        "one word on the sheet is struck through and was not read",
    ),
    ("Del Monte", "Red cherries", ""),
    ("Habit", "Fruit cocktail", ""),
    ("Dolce", "Pineapple slice", ""),
]
