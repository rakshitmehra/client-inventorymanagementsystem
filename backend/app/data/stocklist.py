"""
The items transcribed from the kitchen's own stock sheets.

Five sheets were supplied: a bakery raw-material list, a packaging and
beverage list, a vegetable list split into local and English, and a two-page
"Kitchen Food Cost Report" dated 19-09-2026 that carries a rate and a
measuring unit for each of its 98 lines.

Each row here is:

    (sku, name, category, unit, unit_cost, perishable, note)

`unit_cost` is the rate printed on the cost report; it is 0 for the
handwritten sheets, which carry no prices. `note` records anything read off
the sheet that does not fit a column - a pack size, a brand, or a reading that
is worth a second look. Names are spelled out in full rather than copying the
sheets' shorthand, because "B. choco chips" means nothing to whoever reads the
catalogue next; the original wording is kept in the note where it differed.
"""

# --------------------------------------------------------------------------
# Kitchen Food Cost Report, 19-09-2026 - lines 1 to 98.
# Rate and unit are as printed. These are the only items with known costs.
# --------------------------------------------------------------------------
COST_REPORT = [
    ("KIT-AJI-001", "Ajinomoto", "Spices & Masalas", "kg", 270, False, "sheet notes 0.5 pack"),
    ("KIT-ALO-001", "Aloo Tikki (35 pcs)", "Frozen & Ready Foods", "pcs", 7.29, True, ""),
    ("KIT-AMC-001", "American Corn", "Vegetables", "kg", 80, True, ""),
    ("KIT-AMU-001", "Amul Cheese Processed", "Dairy", "tin", 510, True, ""),
    ("KIT-APP-001", "Apple", "Fruits", "pcs", 40, True, ""),
    ("KIT-AVO-001", "Avocado", "Fruits", "pcs", 90, True, ""),
    ("KIT-ATT-001", "Atta (Wheat Flour)", "Flours & Grains", "kg", 39, False, ""),
    ("KIT-BBC-001", "Baby Corn", "Vegetables", "tin", 115, False, ""),
    ("KIT-BKB-001", "Baked Beans 400 g", "Canned & Preserved", "tin", 80, False, ""),
    ("KIT-BPW-001", "Black Pepper Whole", "Spices & Masalas", "pkt", 800, False, "sheet reads BALCK PAPER WHOLE"),
    ("KIT-BBQ-001", "BBQ Sauce", "Sauces & Condiments", "pkt", 170, False, ""),
    ("KIT-BRG-001", "Biryani Gravy", "Sauces & Condiments", "kg", 350, False, ""),
    ("KIT-BLO-001", "Black Olive 1.5 kg", "Canned & Preserved", "kg", 680, False, ""),
    ("KIT-BRC-001", "Bread Crumb", "Bakery Supplies", "kg", 58.66, False, ""),
    ("KIT-BUT-001", "Butter", "Dairy", "kg", 566, True, ""),
    ("KIT-CHM-001", "Chat Masala", "Spices & Masalas", "pkt", 65, False, ""),
    ("KIT-CHS-001", "Cheese Slice (51 pcs)", "Dairy", "pcs", 8.23, True, ""),
    ("KIT-CHF-001", "Chilli Flakes", "Spices & Masalas", "kg", 300, False, ""),
    ("KIT-CPT-001", "Chipotle Sauce", "Sauces & Condiments", "kg", 220, False, ""),
    ("KIT-CNF-001", "Corn Flour 700 g", "Flours & Grains", "pkt", 40, False, ""),
    ("KIT-CRM-001", "Cream", "Dairy", "l", 190, True, ""),
    ("KIT-CRD-001", "Curd", "Dairy", "kg", 75, True, ""),
    ("KIT-DJM-001", "Dijon Mustard", "Sauces & Condiments", "btl", 230, False, ""),
    ("KIT-DGM-001", "Degi Mirch", "Spices & Masalas", "pcs", 100, False, "unit printed as pcs; likely a packet"),
    ("KIT-DHP-001", "Dhaniya Powder", "Spices & Masalas", "pkt", 35, False, ""),
    ("KIT-FET-001", "Feta Cheese", "Dairy", "pkt", 480, True, ""),
    ("KIT-ELP-001", "Elaichi Powder", "Spices & Masalas", "pkt", 127, False, ""),
    ("KIT-FIL-001", "Filler Cheese 500 g", "Dairy", "kg", 420, True, ""),
    ("KIT-FRF-001", "French Fries", "Frozen & Ready Foods", "kg", 153, False, ""),
    ("KIT-JAL-001", "Jalapeno 1.5 kg", "Canned & Preserved", "kg", 213.5, False, "sheet reads GALAPENO"),
    ("KIT-GRM-001", "Garam Masala", "Spices & Masalas", "g", 50, False, "unit printed as GM"),
    ("KIT-GAR-001", "Garlic", "Vegetables", "kg", 200, True, ""),
    ("KIT-GMY-001", "Garlic Mayo", "Sauces & Condiments", "kg", 190, False, ""),
    ("KIT-GPW-001", "Garlic Powder 320 g", "Spices & Masalas", "pkt", 210, False, ""),
    ("KIT-GOU-001", "Gouda Cheese", "Dairy", "btl", 195, True, "unit printed as BTL; check - cheese is usually weighed"),
    ("KIT-GCS-001", "Green Chilli Sauce 650 g", "Sauces & Condiments", "btl", 65, False, ""),
    ("KIT-HRS-001", "Harissa", "Sauces & Condiments", "kg", 235, False, ""),
    ("KIT-HCP-001", "Herb Chilly Patty (27)", "Frozen & Ready Foods", "pcs", 9.44, True, ""),
    ("KIT-HAL-001", "Haldi (Turmeric)", "Spices & Masalas", "pkt", 55, False, ""),
    ("KIT-HON-001", "Honey", "Sweeteners", "kg", 390, False, ""),
    ("KIT-HMS-001", "Honey Mustard", "Sauces & Condiments", "kg", 220, False, ""),
    ("KIT-JEP-001", "Jeera Powder", "Spices & Masalas", "kg", 76, False, ""),
    ("KIT-KDS-001", "Kadhai Sauce", "Sauces & Condiments", "kg", 195, False, ""),
    ("KIT-KAJ-001", "Kaju (Cashew)", "Chocolate & Nuts", "kg", 880, False, ""),
    ("KIT-KSM-001", "Kasoori Methi", "Spices & Masalas", "pkt", 26, False, ""),
    ("KIT-KKP-001", "Kitchen King Powder", "Spices & Masalas", "pkt", 74, False, ""),
    ("KIT-LAS-001", "Lasagne 500 g", "Pasta & Noodles", "box", 220, False, ""),
    ("KIT-MAG-001", "Maggi", "Pasta & Noodles", "pkt", 8.96, False, ""),
    ("KIT-MAI-001", "Maida (Refined Flour)", "Flours & Grains", "kg", 37, False, ""),
    ("KIT-MKH-001", "Makhana", "Chocolate & Nuts", "pkt", 130, False, ""),
    ("KIT-MKS-001", "Makhani Sauce", "Sauces & Condiments", "kg", 220, False, ""),
    ("KIT-MKA-001", "Makki Atta (Corn Flour)", "Flours & Grains", "kg", 50, False, ""),
    ("KIT-MSF-001", "Masala Fries 1.5 kg", "Frozen & Ready Foods", "kg", 206.66, False, ""),
    ("KIT-MYO-001", "Mayonnaise", "Sauces & Condiments", "kg", 110, False, ""),
    ("KIT-MLP-001", "Milk Purple", "Dairy", "l", 47, True, "brand shorthand from the sheet"),
    ("KIT-MLR-001", "Milk Red", "Dairy", "l", 67, True, "brand shorthand from the sheet"),
    ("KIT-MNS-001", "Mint Sauce", "Sauces & Condiments", "kg", 220, False, ""),
    ("KIT-MSO-001", "Mustard Oil", "Oils & Fats", "l", 160, False, ""),
    ("KIT-MSS-001", "Mustard Sauce", "Sauces & Condiments", "kg", 225, False, ""),
    ("KIT-NCH-001", "Nachos", "Frozen & Ready Foods", "pkt", 32, False, ""),
    ("KIT-NDL-001", "Noodles 800 g", "Pasta & Noodles", "pkt", 70, False, ""),
    ("KIT-ORG-001", "Oregano", "Spices & Masalas", "kg", 280, False, ""),
    ("KIT-PNR-001", "Paneer", "Dairy", "kg", 280, True, ""),
    ("KIT-PEN-001", "Penne Pasta", "Pasta & Noodles", "pkt", 106, False, ""),
    ("KIT-PAP-001", "Papad", "Frozen & Ready Foods", "pkt", 80, False, ""),
    ("KIT-PRM-001", "Parmesan 200 g", "Dairy", "pkt", 640, True, ""),
    ("KIT-PNT-001", "Peanut", "Chocolate & Nuts", "pkt", 60, False, ""),
    ("KIT-PPM-001", "Peri Peri Masala 250 g", "Spices & Masalas", "pkt", 160, False, ""),
    ("KIT-PNS-001", "Pineapple Slice", "Canned & Preserved", "tin", 100, False, ""),
    ("KIT-PZC-001", "Pizza Cheese", "Dairy", "kg", 475, True, ""),
    ("KIT-PZD-001", "Pizza Dough Mixture 500 g", "Bakery Supplies", "pkt", 165, False, ""),
    ("KIT-PZP-001", "Pizza Pasta Sauce", "Sauces & Condiments", "kg", 160, False, ""),
    ("KIT-PZS-001", "Pizza Spice Mix", "Spices & Masalas", "kg", 420, False, ""),
    ("KIT-POW-001", "Potato Wedges 2.5 kg", "Frozen & Ready Foods", "kg", 192, False, ""),
    ("KIT-RFO-001", "Refined Oil", "Oils & Fats", "l", 115, False, ""),
    ("KIT-RCH-001", "Roasted Channa 20 g", "Frozen & Ready Foods", "pkt", 55, False, ""),
    ("KIT-RIC-001", "Rice", "Flours & Grains", "kg", 105, False, ""),
    ("KIT-SLT-001", "Salt", "Spices & Masalas", "kg", 26, False, ""),
    ("KIT-SZW-001", "Schezwan Sauce", "Sauces & Condiments", "kg", 185, False, ""),
    ("KIT-SYC-001", "Soya Chura 200 g", "Flours & Grains", "pkt", 48, False, ""),
    ("KIT-SYS-001", "Soya Sauce 750 g", "Sauces & Condiments", "btl", 55, False, ""),
    ("KIT-SPG-001", "Spaghetti 500 g", "Pasta & Noodles", "kg", 170, False, ""),
    ("KIT-SRR-001", "Sriracha Sauce 320 g", "Sauces & Condiments", "btl", 150, False, ""),
    ("KIT-SDT-001", "Sundried Tomato", "Canned & Preserved", "btl", 180, False, ""),
    ("KIT-SUR-001", "Sushi Rice", "Flours & Grains", "kg", 480, False, ""),
    ("KIT-SUP-001", "Super Patty (15 pcs)", "Frozen & Ready Foods", "pcs", 15.66, True, ""),
    ("KIT-SUZ-001", "Suji (Semolina)", "Flours & Grains", "kg", 35, False, ""),
    ("KIT-TAC-001", "Tacos (12 pcs)", "Frozen & Ready Foods", "pcs", 14.16, False, ""),
    ("KIT-TDM-001", "Tandoori Masala", "Spices & Masalas", "pkt", 300, False, ""),
    ("KIT-TDS-001", "Tandoori Sauce", "Sauces & Condiments", "kg", 220, False, ""),
    ("KIT-THS-001", "Thousand Island Sauce 1 kg", "Sauces & Condiments", "kg", 185, False, ""),
    ("KIT-TMK-001", "Tomato Ketchup", "Sauces & Condiments", "btl", 82, False, ""),
    ("KIT-TOR-001", "Tortilla Roti (10 pcs)", "Frozen & Ready Foods", "pcs", 8, False, ""),
    ("KIT-VIN-001", "Vinegar 600 g", "Sauces & Condiments", "btl", 55, False, ""),
    ("KIT-VOO-001", "Virgin Olive Oil", "Oils & Fats", "btl", 980, False, ""),
    ("KIT-WSB-001", "Wasabi Tube", "Sauces & Condiments", "tube", 140, False, ""),
    ("KIT-WLN-001", "Walnut", "Chocolate & Nuts", "kg", 1100, False, ""),
    ("KIT-WRC-001", "Whole Red Chilli", "Spices & Masalas", "kg", 300, False, ""),
]

# --------------------------------------------------------------------------
# Bakery raw materials - handwritten sheet, 43 numbered lines, no prices.
# --------------------------------------------------------------------------
BAKERY = [
    ("BKY-MAI-001", "Maida (Refined Flour)", "Flours & Grains", "kg", "DUPLICATE:KIT-MAI-001"),
    ("BKY-CHN-001", "Chini (Sugar)", "Sweeteners", "kg", ""),
    ("BKY-YST-001", "Yeast", "Baking Essentials", "kg", ""),
    ("BKY-BUT-001", "Butter", "Dairy", "kg", "DUPLICATE:KIT-BUT-001"),
    ("BKY-MLK-001", "Milk", "Dairy", "l", ""),
    ("BKY-GHE-001", "Ghee Marvo (Amrit)", "Oils & Fats", "kg", "brand as written on the sheet"),
    ("BKY-ROL-001", "Refined Oil", "Oils & Fats", "l", "DUPLICATE:KIT-RFO-001"),
    ("BKY-DRF-001", "Dry Fruit", "Chocolate & Nuts", "kg", ""),
    ("BKY-BCC-001", "Choco Chips", "Chocolate & Nuts", "kg", "sheet reads 'B. choco chips' - B. not resolved"),
    ("BKY-COC-001", "Cocoa Powder", "Chocolate & Nuts", "kg", ""),
    ("BKY-DKC-001", "Dark Compound", "Chocolate & Nuts", "kg", "sheet reads 'D-Compound'"),
    ("BKY-WHC-001", "White Compound", "Chocolate & Nuts", "kg", "sheet reads 'W-Compound'"),
    ("BKY-CRC-001", "Cream Cheese", "Dairy", "kg", ""),
    ("BKY-OAT-001", "Oats", "Flours & Grains", "kg", ""),
    ("BKY-CRF-001", "Corn Flakes", "Flours & Grains", "kg", ""),
    ("BKY-BRV-001", "Bournvita", "Beverages", "kg", ""),
    ("BKY-CNP-001", "Coconut Powder", "Bakery Supplies", "kg", "sheet abbreviates as 'Coconut po.'"),
    ("BKY-MKP-001", "Milk Powder", "Dairy", "kg", ""),
    ("BKY-BIM-001", "Bread Improver", "Baking Essentials", "kg", ""),
    ("BKY-GLU-001", "Gluten", "Baking Essentials", "kg", "sheet reads 'G-fuden' - read as gluten"),
    ("BKY-CAL-001", "Calcium", "Baking Essentials", "kg", "bread calcium propionate, assumed"),
    ("BKY-SDB-001", "Sodium Bicarbonate", "Baking Essentials", "kg", "sheet abbreviates as 'Sodium bo.'"),
    ("BKY-MSD-001", "Meetha Soda", "Baking Essentials", "kg", ""),
    ("BKY-ELP-001", "Elaichi Powder", "Spices & Masalas", "kg", "DUPLICATE:KIT-ELP-001"),
    ("BKY-BKP-001", "Baking Powder", "Baking Essentials", "kg", ""),
    ("BKY-CHL-001", "Choco Lava", "Finished Goods", "pcs", ""),
    ("BKY-CKR-001", "Cake Rusk", "Finished Goods", "kg", ""),
    ("BKY-TTM-001", "Tea Time", "Finished Goods", "kg", "product name as written"),
    ("BKY-SNF-001", "Saunf (Fennel)", "Spices & Masalas", "kg", ""),
    ("BKY-AJW-001", "Ajwain", "Spices & Masalas", "kg", ""),
    ("BKY-JEE-001", "Jeera (Cumin)", "Spices & Masalas", "kg", ""),
    ("BKY-KHS-001", "Khus Khus (Poppy Seed)", "Spices & Masalas", "kg", "sheet reads 'Khush-2'"),
    ("BKY-HON-001", "Honey", "Sweeteners", "kg", "DUPLICATE:KIT-HON-001"),
    ("BKY-KHJ-001", "Khajoor (Dates)", "Chocolate & Nuts", "kg", ""),
    ("BKY-APP-001", "Apple", "Fruits", "pcs", "DUPLICATE:KIT-APP-001"),
    ("BKY-BAN-001", "Banana", "Fruits", "pcs", ""),
    ("BKY-GAR-001", "Garlic", "Vegetables", "kg", "DUPLICATE:KIT-GAR-001"),
    ("BKY-MLG-001", "Multigrain", "Flours & Grains", "kg", ""),
    ("BKY-ORG-001", "Oregano", "Spices & Masalas", "kg", "DUPLICATE:KIT-ORG-001"),
    ("BKY-PZK-001", "Pizza Sprinkler", "Spices & Masalas", "pkt", ""),
    ("BKY-CHF-001", "Chilli Flakes", "Spices & Masalas", "kg", "DUPLICATE:KIT-CHF-001"),
    ("BKY-CRL-001", "Caramel (Dark)", "Sweeteners", "kg", ""),
    ("BKY-MTM-001", "Mithai Mate", "Dairy", "kg", ""),
]

# --------------------------------------------------------------------------
# Vegetables - handwritten sheet, split local / English. No prices.
# The sheet lists carrot twice (lines 4 and 19); it is entered once.
# --------------------------------------------------------------------------
VEGETABLES_LOCAL = [
    ("VEG-CAB-001", "Cabbage"),
    ("VEG-CPS-001", "Capsicum"),
    ("VEG-MSH-001", "Mushroom"),
    ("VEG-CRT-001", "Carrot"),
    ("VEG-POT-001", "Potato"),
    ("VEG-BNS-001", "Beans"),
    ("VEG-TOM-001", "Tomato"),
    ("VEG-GNG-001", "Ginger"),
    ("VEG-COR-001", "Coriander"),
    ("VEG-CUC-001", "Cucumber"),
    ("VEG-CFL-001", "Cauliflower"),
    ("VEG-ONI-001", "Onion"),
    ("VEG-LEM-001", "Lemon"),
    ("VEG-MNT-001", "Mint"),
    ("VEG-GCH-001", "Green Chilli"),
    ("VEG-PLK-001", "Palak (Spinach)"),
    ("VEG-BTR-001", "Beetroot"),
]

VEGETABLES_ENGLISH = [
    ("VEG-ZUC-001", "Zucchini Red & Yellow"),
    ("VEG-RCB-001", "Red Cabbage"),
    ("VEG-BRO-001", "Broccoli"),
    ("VEG-PRS-001", "Parsley"),
    ("VEG-CHT-001", "Cherry Tomato"),
    ("VEG-BSL-001", "Basil"),
    ("VEG-ICE-001", "Iceberg Lettuce"),
    ("VEG-SPO-001", "Spring Onion"),
    ("VEG-BPP-001", "Bell Peppers"),
]

# --------------------------------------------------------------------------
# Packaging and beverages - handwritten sheet, no prices and no quantities.
# --------------------------------------------------------------------------
PACKAGING = [
    ("PKG-CKB-001", "Cake Box 9x9x6", "Packaging", "pcs", ""),
    ("PKG-COB-001", "Cookies Box", "Packaging", "pcs", ""),
    ("PKG-PB2-001", "Pastry Box (2)", "Packaging", "pcs", ""),
    ("PKG-PB4-001", "Pastry Box (4)", "Packaging", "pcs", ""),
    ("PKG-PB6-001", "Pastry Box (6)", "Packaging", "pcs", ""),
    ("PKG-DC3-001", "Dry Cake Box 300 g (OPS 14L)", "Packaging", "pcs", ""),
    ("PKG-DC5-001", "Dry Cake Box 500 g (OPS 38)", "Packaging", "pcs", ""),
    ("PKG-BC5-001", "Black Container 500 ml", "Packaging", "pcs", ""),
    ("PKG-BC7-001", "Black Container 750 ml", "Packaging", "pcs", ""),
    ("PKG-PL5-001", "5 Compartment Plate", "Packaging", "pcs", "sheet reads '5cp plate'"),
    ("PKG-TPB-001", "Transparent Single Pastry Box", "Packaging", "pcs", "sheet reads 'Trans parde + mingle pastry box'"),
    ("PKG-DIP-001", "Dip Container", "Packaging", "pcs", "sheet reads 'Dip' only"),
]

BEVERAGES = [
    ("BEV-DTC-001", "Diet Coke", "Beverages", "btl", ""),
    ("BEV-HEL-001", "Hell Energy Drink", "Beverages", "btl", ""),
    ("BEV-MNW-001", "Mineral Water", "Beverages", "btl", "sheet reads 'm/water'"),
    ("BEV-RDB-001", "Red Bull", "Beverages", "btl", ""),
]

# Categories the sheets imply, with the description that will be stored.
CATEGORIES = [
    ("Vegetables", "Fresh local and imported vegetables and salad leaves"),
    ("Fruits", "Fresh fruit used in the bakery and the kitchen"),
    ("Spices & Masalas", "Ground and whole spices, masalas and seasoning blends"),
    ("Sauces & Condiments", "Bottled and bulk sauces, dressings, pastes and ketchup"),
    ("Oils & Fats", "Cooking oils, ghee and other fats"),
    ("Pasta & Noodles", "Dried pasta, noodles and lasagne sheets"),
    ("Frozen & Ready Foods", "Frozen patties, fries, wedges and other prepared items"),
    ("Canned & Preserved", "Tinned and jarred vegetables, olives, beans and fruit"),
    ("Bakery Supplies", "Crumbs, mixes and other prepared bakery inputs"),
    ("Beverages", "Soft drinks, energy drinks, water and drink powders"),
    ("Packaging", "Boxes, containers, plates and other serving packaging"),
]

# One line on the bakery sheet could not be read with any confidence and is
# deliberately not imported - guessing at an ingredient name is worse than
# leaving a gap somebody can fill in.
UNREAD = [
    ("Bakery sheet line 21", "Calcium", "imported as Calcium; the sheet gives no further detail"),
]
